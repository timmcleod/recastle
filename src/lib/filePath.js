// A path split into its folder, with the trailing slash, and the name after it. A
// repository inside this one, "nested/", keeps its slash as part of its name.
export function splitPath(path) {
  const slash = path.lastIndexOf("/", path.length - 2);
  return { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}
