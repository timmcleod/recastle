import { invoke } from "@tauri-apps/api/core";
import { definitionSearch, envReadSearch, envSetSearch, importOf, importsByPath, pathsOf, ranked, targetAt } from "./definitions.js";
import { isDotenv } from "./dotenv.js";
import { knownFiles, repositoryFiles } from "./repositoryFiles.js";

// Going to a definition from the Files view's editor (see definitions.js): whether
// what's under the pointer goes anywhere, as the pointer moves over it with Ctrl (⌘)
// held, and where, once it's clicked.

// No more places are offered than this, the nearest the file it's used in first.
export const MOST_PLACES = 200;

// The repository's files, as the Files view shows them, as a Set, for a path written in
// a file to be looked for among them: made once for each list read (see repositoryFiles.js).
const sets = new WeakMap();
const asSet = (files) => {
  if (!sets.has(files)) sets.set(files, new Set(files));
  return sets.get(files);
};
const filesIn = async (path) => asSet(await repositoryFiles(path, { untracked: true }));

/**
 * What's at `column` (from 0) in `text`, a line of `file` in the repository at `path`,
 * that a click could go to, as targetAt has it, or null: a path only once it's known
 * to be one of the repository's files, as `file`, the file it is. Until they've been
 * read, which this starts, there's none.
 */
export function linkAt(path, file, text, column) {
  const target = targetAt(text, column, file);
  if (target?.kind !== "path") return target;
  const files = knownFiles(path, { untracked: true });
  if (!files) return null;
  const found = target.paths.find((p) => asSet(files).has(p));
  return found ? { ...target, file: found } : null;
}

/**
 * Where `target`, as linkAt has it, at `line` of `file`, whose text is `text`, goes:
 * [{ file, line, text }], most likely first, `line` null for the top of the file. A
 * name a script imports goes to the file it's from, or its definition there; another,
 * to where a search of the repository finds it defined, or with none, what it's in, as
 * a PHP enum for its cases(), which PHP defines. An environment variable goes to where
 * the repository's .env files set it, or where the app reads it.
 */
export async function destinations(path, file, text, target, line) {
  if (target.kind === "env") {
    const found = target.find === "set" ? await envSet(path, target.name) : await find(path, envReadSearch(target.name));
    return ranked(found, file, line).slice(0, MOST_PLACES);
  }
  if (target.kind === "path") {
    const files = await filesIn(path);
    const found = target.paths.find((p) => files.has(p));
    return found ? [{ file: found, line: null, text: "" }] : [];
  }
  const imported = importsByPath(file) && importOf(text, target.name);
  if (imported) {
    const files = await filesIn(path);
    const from = pathsOf(imported.spec, file).find((p) => files.has(p));
    if (from && !imported.named) return [{ file: from, line: null, text: "" }];
    if (from) {
      const there = await search(path, imported.original, file, [from]);
      return there.length ? there : [{ file: from, line: null, text: "" }];
    }
  }
  const found = await search(path, target.name, file);
  const places = found.length || !target.owner ? found : await search(path, target.owner, file);
  return ranked(places, file, line).slice(0, MOST_PLACES);
}

// The lines that would define `name`, used in `file`: in `files`, or with none, the
// files of its language.
function search(path, name, file, files = null) {
  const { patterns, globs } = definitionSearch(name, file);
  return files ? find(path, { patterns, files }) : find(path, { patterns, globs });
}

// Where the .env files set the variable `name`: those git ignores too, as .env is.
async function envSet(path, name) {
  const files = (await repositoryFiles(path, { untracked: true })).filter(isDotenv);
  return files.length ? find(path, { ...envSetSearch(name), files, ignored: true }) : [];
}

// The lines matching `patterns` in the repository at `path`, in `globs` or `files`, as
// find_definitions has them.
const find = (path, { patterns, globs = [], files = [], ignored = false }) => invoke("find_definitions", { path, patterns, globs, files, ignored });

// What's said when going to `target` finds nothing.
function nothingFound(target) {
  if (target.kind === "env") return target.find === "set" ? `“${target.name}” isn't set in a .env file` : `Nothing reads “${target.name}”`;
  return `No definition found for “${target.name ?? target.file}”`;
}

/**
 * The menu of `places`, as destinations finds them, for going to one with `go(place)`:
 * each a file and line, with the line's text, filtered by what's typed when there are
 * many; or, with none, a note that `target` wasn't found.
 */
export function placesMenu(places, target, go) {
  if (!places.length) return [{ label: nothingFound(target), disabled: true }];
  const many = places.length > 8;
  return [
    many && { filter: "Filter", empty: "No matches" },
    ...places.map((place) => ({ label: `${place.file}:${place.line}`, detail: place.text, filterable: many, action: () => go(place) })),
  ].filter(Boolean);
}
