// Settings → search: which settings match what was typed. Every word has to appear in
// the setting's text (name, hint, value labels) or in its group's title; case and
// accents don't matter.

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

export function matches(words: readonly string[], text: string, groupTitle = ""): boolean {
  if (words.length === 0) return true;
  const haystack = fold(`${groupTitle} ${text}`);
  return words.every((word) => haystack.includes(word));
}

/**
 * Shows the settings under `root` that match and hides the rest: each group's items
 * (fields, toggles, shortcut rows), and a group with none left. Returns how many
 * items show.
 */
export function applyFilter(root: HTMLElement, query: string): number {
  const words = queryWords(query);
  let shown = 0;
  for (const group of root.querySelectorAll<HTMLElement>(".settings-group")) {
    const title = group.querySelector("legend")?.textContent ?? "";
    const items = [...group.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.tagName !== "LEGEND");
    let visible = 0;
    for (const item of items) {
      // The shortcuts table: one row per shortcut.
      const rows = item.querySelectorAll<HTMLElement>(".shortcut");
      if (rows.length) {
        let rowsShown = 0;
        for (const row of rows) {
          const show = matches(words, `${row.textContent ?? ""} ${row.querySelector("input")?.value ?? ""}`, title);
          row.hidden = !show;
          if (show) rowsShown++;
        }
        item.hidden = rowsShown === 0;
        visible += rowsShown;
        continue;
      }
      const values = [...item.querySelectorAll<HTMLSelectElement>("select")].map((s) => [...s.options].map((o) => o.text).join(" ")).join(" ");
      const show = matches(words, `${item.textContent ?? ""} ${values}`, title);
      item.hidden = !show;
      if (show) visible++;
    }
    group.hidden = visible === 0;
    shown += visible;
  }
  return shown;
}
