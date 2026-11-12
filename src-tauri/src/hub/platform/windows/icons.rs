use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    fs::{self, File},
    io::Read,
    path::{Component, Path, Prefix},
};
use windows::{
    core::{Interface, PCWSTR},
    Win32::{
        Foundation::SIZE,
        Graphics::{
            Gdi::{DeleteObject, HBITMAP, HPALETTE},
            Imaging::{
                CLSID_WICBmpDecoder, CLSID_WICGifDecoder, CLSID_WICIcoDecoder,
                CLSID_WICImagingFactory, CLSID_WICJpegDecoder, CLSID_WICPngDecoder2,
                GUID_WICPixelFormat32bppRGBA, IWICBitmapDecoder, IWICBitmapSource,
                IWICImagingFactory, WICBitmapDitherTypeNone, WICBitmapIgnoreAlpha,
                WICBitmapInterpolationModeFant, WICBitmapPaletteTypeCustom,
                WICBitmapUsePremultipliedAlpha, WICDecodeMetadataCacheOnDemand,
            },
        },
        Storage::FileSystem::GetDriveTypeW,
        System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
        UI::Shell::{IShellItem, IShellItemImageFactory, SIIGBF_ICONONLY},
    },
};

const ICON_SIZE: u32 = 96;
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_DIMENSION: u32 = 4096;

struct ShellBitmap(HBITMAP);

impl Drop for ShellBitmap {
    fn drop(&mut self) {
        let _ = unsafe { DeleteObject(self.0.into()) };
    }
}

pub(super) fn factory() -> windows::core::Result<IWICImagingFactory> {
    unsafe { CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER) }
}

pub(super) fn shell_icon(
    factory: &IWICImagingFactory,
    item: &IShellItem,
) -> Result<String, String> {
    let get_image = || -> windows::core::Result<_> {
        let images: IShellItemImageFactory = item.cast()?;
        let size = SIZE {
            cx: ICON_SIZE as i32,
            cy: ICON_SIZE as i32,
        };
        unsafe { images.GetImage(size, SIIGBF_ICONONLY) }
    };
    let bitmap = ShellBitmap(get_image().map_err(|error| error.to_string())?);
    let source = unsafe {
        factory.CreateBitmapFromHBITMAP(
            bitmap.0,
            HPALETTE::default(),
            WICBitmapUsePremultipliedAlpha,
        )
    }
    .map_err(|error| error.to_string())?;
    let (width, height, mut pixels) = rasterize(factory, &source)?;
    // Some legacy icon bitmaps omit alpha entirely. Preserve their visible colour data.
    if pixels.chunks_exact(4).all(|pixel| pixel[3] == 0) {
        let source = unsafe {
            factory.CreateBitmapFromHBITMAP(bitmap.0, HPALETTE::default(), WICBitmapIgnoreAlpha)
        }
        .map_err(|error| error.to_string())?;
        (_, _, pixels) = rasterize(factory, &source)?;
    }
    encode_png(width, height, &pixels)
}

pub(super) fn local_disk(path: &Path) -> bool {
    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return false;
    };
    let drive = match prefix.kind() {
        Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) if path.is_absolute() => drive,
        _ => return false,
    };
    let root = [u16::from(drive), b':' as u16, b'\\' as u16, 0];
    let drive_type = unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) };
    // Windows drive types: removable, fixed, CD-ROM, RAM disk. Exclude mapped shares.
    matches!(drive_type, 2 | 3 | 5 | 6)
}

pub(super) fn custom_icon(path: &Path) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let codec = match extension.as_str() {
        "bmp" => CLSID_WICBmpDecoder,
        "gif" => CLSID_WICGifDecoder,
        "ico" => CLSID_WICIcoDecoder,
        "jpeg" | "jpg" => CLSID_WICJpegDecoder,
        "png" => CLSID_WICPngDecoder2,
        _ => return Err("Choose a PNG, JPG, ICO, BMP or GIF image.".into()),
    };
    if !local_disk(path) {
        return Err("Choose an image on a local Windows drive.".into());
    }
    let path =
        fs::canonicalize(path).map_err(|error| format!("Could not read the icon file. {error}"))?;
    if !local_disk(&path) || !path.is_file() {
        return Err("Choose an image file on a local Windows drive.".into());
    }

    let file =
        File::open(path).map_err(|error| format!("Could not read the icon file. {error}"))?;
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the icon file. {error}"))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("The icon image must be 8 MB or smaller.".into());
    }

    let (factory, frame) = (|| -> windows::core::Result<_> {
        let factory = factory()?;
        let stream = unsafe { factory.CreateStream()? };
        // WIC reads this buffer until its stream/decoder/frame are dropped. `bytes`
        // lives past rasterization, and the initialized stream is never written to.
        unsafe { stream.InitializeFromMemory(&bytes)? };
        let decoder: IWICBitmapDecoder =
            unsafe { CoCreateInstance(&codec, None, CLSCTX_INPROC_SERVER)? };
        unsafe { decoder.Initialize(&stream, WICDecodeMetadataCacheOnDemand)? };

        let frame = unsafe { decoder.GetFrame(0)? };
        if extension != "ico" {
            return Ok((factory, frame));
        }
        let mut best_frame = frame;
        let (width, height) = dimensions(&best_frame)?;
        let mut best_area = u64::from(width) * u64::from(height);
        for index in 1..unsafe { decoder.GetFrameCount()? }.min(64) {
            let candidate = unsafe { decoder.GetFrame(index)? };
            let (width, height) = dimensions(&candidate)?;
            let area = u64::from(width) * u64::from(height);
            if area > best_area && width <= MAX_DIMENSION && height <= MAX_DIMENSION {
                best_frame = candidate;
                best_area = area;
            }
        }
        Ok((factory, best_frame))
    })()
    .map_err(|error| format!("Could not decode the icon image. {error}"))?;

    let (width, height, pixels) = rasterize(&factory, &frame)?;
    encode_png(width, height, &pixels)
}

fn dimensions(source: &IWICBitmapSource) -> windows::core::Result<(u32, u32)> {
    let (mut width, mut height) = (0, 0);
    unsafe { source.GetSize(&mut width, &mut height)? };
    Ok((width, height))
}

fn rasterize(
    factory: &IWICImagingFactory,
    source: &IWICBitmapSource,
) -> Result<(u32, u32, Vec<u8>), String> {
    let (width, height) = dimensions(source).map_err(|error| error.to_string())?;
    let longest = width.max(height);
    if width == 0 || height == 0 || longest > MAX_DIMENSION {
        return Err("The icon image must have dimensions between 1 and 4096 pixels.".into());
    }

    let convert = || -> windows::core::Result<_> {
        let (source, width, height) = if longest > ICON_SIZE {
            let width = (width * ICON_SIZE / longest).max(1);
            let height = (height * ICON_SIZE / longest).max(1);
            let scaler = unsafe { factory.CreateBitmapScaler()? };
            unsafe { scaler.Initialize(source, width, height, WICBitmapInterpolationModeFant)? };
            (scaler.cast::<IWICBitmapSource>()?, width, height)
        } else {
            (source.clone(), width, height)
        };
        let converter = unsafe { factory.CreateFormatConverter()? };
        unsafe {
            converter.Initialize(
                &source,
                &GUID_WICPixelFormat32bppRGBA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )?;
        }
        let mut pixels = vec![0; (width * height * 4) as usize];
        unsafe { converter.CopyPixels(std::ptr::null(), width * 4, &mut pixels)? };
        Ok((width, height, pixels))
    };
    convert().map_err(|error| format!("Could not rasterize the icon image. {error}"))
}

fn encode_png(width: u32, height: u32, pixels: &[u8]) -> Result<String, String> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
    writer
        .write_image_data(pixels)
        .map_err(|error| error.to_string())?;
    writer.finish().map_err(|error| error.to_string())?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}
