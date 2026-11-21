import { render } from "preact";
import { App } from "./ui/App";
import { EditorApp } from "./ui/Editor";
import "./ui/app.css";

// The memo window (tauri.conf.json, url ?editor) runs this same bundle.
render(location.search === "?editor" ? <EditorApp /> : <App />, document.getElementById("root")!);
