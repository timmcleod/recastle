import { afterEach, expect, test } from "vitest";
import { syntaxTree } from "@codemirror/language";
import { createState, createView, linkUnder, loadLanguage, placeOf, showPlace } from "./codeEditor.js";

let view;
afterEach(() => view?.destroy());

// An editor whose goTo hook finds "formatSize" wherever it is, drawn from x 0 to 100.
function editor(text) {
  const goTo = {
    at: (line, column) => {
      const from = line.indexOf("formatSize");
      return from >= 0 && column >= from && column <= from + 10 ? { from, to: from + 10, name: "formatSize" } : null;
    },
    go: () => {},
  };
  view = createView(document.createElement("div"), createState(text, "a.js", { tabSize: 2, highlight: false, wrap: false, goTo }));
  // The page has no layout to measure: the line's text is at x 0 to 100.
  view.posAtCoords = ({ x }) => Math.min(Math.floor(x / 10), text.length);
  view.coordsAtPos = (pos) => ({ left: pos * 10, right: pos * 10, top: 0, bottom: 20 });
  return view;
}

test("what goes somewhere is under the pointer only on it, not on the space beside it", () => {
  editor("formatSize");
  expect(linkUnder(view, 50, 10)).toMatchObject({ from: 0, to: 10, line: 1, target: { name: "formatSize" } });
  // posAtCoords takes the line's end as nearest, past it.
  expect(linkUnder(view, 160, 10)).toBeNull();
  expect(linkUnder(view, 50, 40)).toBeNull();
});

test("a .env file is read as one, named so for the status bar", async () => {
  view = createView(document.createElement("div"), createState("APP_NAME=Laravel", ".env.example", { tabSize: 2, highlight: true, wrap: false }));
  expect(await loadLanguage(view, ".env.example", () => true)).toBe(".env");
  expect(syntaxTree(view.state).length).toBeGreaterThan(0);
});

test("a file comes back with its cursor and scroll as left, its cursor kept within text since shortened", () => {
  editor("one\ntwo\nthree");
  view.dispatch({ selection: { anchor: 4, head: 7 } });
  const place = placeOf(view);
  expect(place).toMatchObject({ anchor: 4, head: 7 });
  expect(place.scroll).toBeTruthy();

  view.setState(createState("one", "a.js", { tabSize: 2, highlight: false, wrap: false }));
  showPlace(view, place);
  expect(view.state.selection.main).toMatchObject({ anchor: 3, head: 3 });
});

test("hidden behind a preview, the scroll as the preview opened is kept in place of the editor's own", () => {
  editor("one");
  const before = view.scrollSnapshot();
  expect(placeOf(view, before).scroll).toBe(before);
});

test("a file not opened before shows from its start, not as far down as the one before it", () => {
  editor("one");
  view.scrollDOM.scrollTop = 300;
  view.scrollDOM.scrollLeft = 40;
  showPlace(view, undefined);
  expect([view.scrollDOM.scrollTop, view.scrollDOM.scrollLeft]).toEqual([0, 0]);
});
