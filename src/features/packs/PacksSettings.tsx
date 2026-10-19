import { useEffect, useState } from "react";
import type { Pack } from "../../ipc";
import { AddPack, PackImage } from "./PackParts";
import { packCount, TEXT_COLOR, usePacks } from "./packs";

/** Settings → Icon & image packs: what's in the vault, adding and removing packs. */
export function PacksSettings() {
  const { packs, loaded, error, load } = usePacks();
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <p className="settings-hint">
        Packs are kept in this vault (in its hidden <code>.axisnotes/packs</code> folder), so they
        go wherever the vault goes. Icon packs appear under Packs in the icon picker; image packs in
        the cover gallery. Choose a folder or a .zip of images: other files are skipped, and an icon
        pack with SVGs keeps only those.
      </p>
      {error && (
        <p className="icon-note" role="alert">
          Couldn't read the vault's packs: {error}
        </p>
      )}
      <PackGroup title="Icon packs" kind="icons" packs={packs} loaded={loaded} />
      <PackGroup title="Image packs" kind="images" packs={packs} loaded={loaded} />
    </>
  );
}

function PackGroup({
  title,
  kind,
  packs,
  loaded,
}: {
  title: string;
  kind: Pack["kind"];
  packs: Pack[];
  loaded: boolean;
}) {
  const remove = usePacks((s) => s.remove);
  const [error, setError] = useState("");
  /** The pack being moved to the trash (the Recycle Bin can take a few seconds). */
  const [removing, setRemoving] = useState<string | null>(null);
  const mine = packs.filter((p) => p.kind === kind);

  const removePack = async (pack: Pack) => {
    setError("");
    setRemoving(pack.name);
    try {
      await remove(pack.kind, pack.name);
    } catch (e) {
      setError(`Couldn't remove “${pack.name}”: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="pack-settings-group" aria-label={title}>
      <h3>{title}</h3>
      {loaded && mine.length === 0 && <p className="icon-note">None yet.</p>}
      {mine.length > 0 && (
        <ul className="pack-list">
          {mine.map((pack) => (
            <li key={pack.name}>
              <span className="pack-preview" aria-hidden>
                {pack.files.slice(0, kind === "icons" ? 5 : 3).map((f) => (
                  <PackImage
                    key={f}
                    path={f}
                    size={kind === "icons" ? 18 : 28}
                    color={pack.monochrome ? TEXT_COLOR : undefined}
                  />
                ))}
              </span>
              <span className="pack-name" title={pack.dir}>
                {pack.name}
              </span>
              <span className="pack-count">{packCount(pack)}</span>
              <button
                onClick={() => void removePack(pack)}
                disabled={removing !== null}
                title="Moves the pack to the trash. Icons and covers using it go blank."
              >
                {removing === pack.name ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="icon-note" role="alert">
          {error}
        </p>
      )}
      <AddPack kind={kind} />
    </section>
  );
}
