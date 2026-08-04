import playerStyles from "../player-react/player.css?inline";
import { defineVibiumRecordPlayerElement } from "./index";

const styleID = "vibium-record-player-styles";
if (typeof document !== "undefined" && !document.getElementById(styleID)) {
  const style = document.createElement("style");
  style.id = styleID;
  style.textContent = playerStyles;
  document.head.appendChild(style);
}

defineVibiumRecordPlayerElement();
