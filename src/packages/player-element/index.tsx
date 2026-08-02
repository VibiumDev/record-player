import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { RecordPlayerLoader } from "../player-react";
import type { LoadedRecording } from "../player-core";

export interface VibiumRecordPlayerReadyDetail {
  recording: LoadedRecording;
}

export interface VibiumRecordPlayerErrorDetail {
  error: Error;
}

const ELEMENT_NAME = "vibium-record-player";

function visibilityAttribute(value: string | null): boolean | "visible" | "hidden" | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "hidden" || normalized === "false" || normalized === "0") return "hidden";
  if (normalized === "visible" || normalized === "true" || normalized === "1" || normalized === "") return "visible";
  return "visible";
}

function credentialsAttribute(value: string | null): RequestCredentials {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "omit" || normalized === "include") return normalized;
  return "same-origin";
}

export class VibiumRecordPlayerElement extends HTMLElement {
  static get observedAttributes() {
    return ["src", "credentials", "inspector", "timeline"];
  }

  private root: Root | null = null;
  private mount: HTMLDivElement | null = null;

  get credentials(): RequestCredentials {
    return credentialsAttribute(this.getAttribute("credentials"));
  }

  set credentials(value: RequestCredentials) {
    this.setAttribute("credentials", value);
  }

  connectedCallback() {
    if (!this.mount) {
      this.mount = document.createElement("div");
      this.appendChild(this.mount);
    }
    this.render();
  }

  disconnectedCallback() {
    this.root?.unmount();
    this.root = null;
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  private render() {
    if (!this.mount) return;
    if (!this.root) this.root = createRoot(this.mount);
    const src = this.getAttribute("src");
    const credentials = this.credentials;
    const inspector = visibilityAttribute(this.getAttribute("inspector"));
    const timeline = visibilityAttribute(this.getAttribute("timeline"));

    if (!src) {
      this.root.render(<div role="alert">Missing recording src</div>);
      return;
    }

    this.root.render(
      <RecordPlayerLoader
        key={src}
        src={src}
        credentials={credentials}
        inspector={inspector}
        timeline={timeline}
        onReady={(recording) => {
          const detail: VibiumRecordPlayerReadyDetail = { recording };
          this.dispatchEvent(
            new CustomEvent<VibiumRecordPlayerReadyDetail>("vibium-player-ready", {
              bubbles: true,
              detail,
            }),
          );
          this.dispatchEvent(
            new CustomEvent<VibiumRecordPlayerReadyDetail>("ready", {
              bubbles: true,
              detail,
            }),
          );
        }}
        onError={(error) => {
          const detail: VibiumRecordPlayerErrorDetail = { error };
          this.dispatchEvent(
            new CustomEvent<VibiumRecordPlayerErrorDetail>("vibium-player-error", {
              bubbles: true,
              detail,
            }),
          );
          this.dispatchEvent(
            new CustomEvent<VibiumRecordPlayerErrorDetail>("error", {
              bubbles: false,
              cancelable: true,
              detail,
            }),
          );
        }}
      />,
    );
  }
}

export function defineVibiumRecordPlayerElement(name = ELEMENT_NAME): CustomElementConstructor {
  const existing = customElements.get(name);
  if (existing) return existing;
  customElements.define(name, VibiumRecordPlayerElement);
  return VibiumRecordPlayerElement;
}
