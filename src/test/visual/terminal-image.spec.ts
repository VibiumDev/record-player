import { expect, test } from "@playwright/test";

import { nativeVTReference } from "../../packages/ghostty-browser/native-vt-reference";

test("matches native Twee terminal geometry, styling, and pixels", async ({ page }) => {
  await page.goto("/src/test/visual/terminal-image.html");
  const terminal = page.locator("#native-image-target [aria-label='Terminal playback']");
  await expect(terminal).toContainText("plain");
  await expect(terminal).toContainText("界é");
  await page.evaluate(() => document.fonts.ready);

  const geometry = await terminal.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.data.includes("plain") || node.data.includes("界") || node.data.includes("é")) {
        textNodes.push(node);
      }
    }
    const plain = textNodes.find((node) => node.data.includes("plain"));
    const wideText = textNodes.find((node) => node.data.includes("界"));
    const narrowText = textNodes.find((node) => node.data.includes("é"));
    if (!plain || !wideText || !narrowText) throw new Error("expected terminal text nodes");

    const rect = (node: Text, start: number, end = start + 1) => {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      return range.getBoundingClientRect();
    };
    const terminalRect = element.getBoundingClientRect();
    const first = rect(plain, plain.data.indexOf("plain"));
    const second = rect(plain, plain.data.indexOf("plain") + 1);
    const wide = rect(wideText, wideText.data.indexOf("界"));
    const narrow = rect(narrowText, narrowText.data.indexOf("e"), narrowText.data.length);
    let styledElement = narrowText.parentElement!;
    while (
      styledElement.parentElement &&
      element.contains(styledElement.parentElement) &&
      getComputedStyle(styledElement).backgroundColor === "rgba(0, 0, 0, 0)"
    ) {
      styledElement = styledElement.parentElement;
    }
    const computed = getComputedStyle(styledElement);
    return {
      terminal: { width: terminalRect.width, height: terminalRect.height },
      cellAdvance: second.left - first.left,
      rowAdvance: wide.top - first.top,
      wideAdvance: narrow.left - wide.left,
      narrowWidth: narrow.width,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      fontWeight: computed.fontWeight,
      fontStyle: computed.fontStyle,
      textDecorationLine: computed.textDecorationLine,
    };
  });

  expect(geometry.terminal.width).toBe(64);
  expect(geometry.terminal.height).toBe(60);
  expect(geometry.cellAdvance).toBeCloseTo(8, 1);
  expect(geometry.rowAdvance).toBeCloseTo(20, 1);
  expect(geometry.wideAdvance).toBeCloseTo(16, 1);
  expect(geometry.narrowWidth).toBeCloseTo(8, 1);
  expect(geometry.color).toBe("rgb(178, 24, 24)");
  expect(geometry.backgroundColor).toBe("rgb(24, 24, 178)");
  expect(geometry.fontWeight).toBe("700");
  expect(geometry.fontStyle).toBe("italic");
  expect(geometry.textDecorationLine).toContain("underline");

  expect(await terminal.screenshot()).toMatchSnapshot("native-twee-styled.png", {
    threshold: 0.15,
    maxDiffPixelRatio: 0.06,
  });
});

test("matches native complex widths plus inverse and faint colors", async ({ page }) => {
  await page.goto("/src/test/visual/terminal-image.html");
  const terminal = page.locator("#complex-width-target [aria-label='Terminal playback']");
  await expect(terminal).toContainText("👍🏻x");
  await page.evaluate(() => document.fonts.ready);

  const geometry = await terminal.evaluate((element) => {
    const terminalRect = element.getBoundingClientRect();
    const wideCells = Array.from(element.querySelectorAll<HTMLElement>('[data-terminal-cell-width="2"]'));
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const followingLeft: number[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      let index = node.data.indexOf("x");
      while (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        followingLeft.push(range.getBoundingClientRect().left - terminalRect.left);
        index = node.data.indexOf("x", index + 1);
      }
    }
    return {
      terminal: { width: terminalRect.width, height: terminalRect.height },
      wideText: wideCells.map((cell) => cell.textContent),
      wideWidths: wideCells.map((cell) => cell.getBoundingClientRect().width),
      followingLeft,
    };
  });

  expect(geometry.terminal).toEqual({ width: 128, height: 80 });
  expect(geometry.wideText).toEqual(["👍", "🏻", "🇺", "🇸"]);
  for (const width of geometry.wideWidths) expect(width).toBeCloseTo(16, 1);
  expect(geometry.followingLeft).toHaveLength(nativeVTReference.complexWidthLines.length);
  geometry.followingLeft.forEach((left, index) => {
    expect(left).toBeCloseTo(nativeVTReference.complexWidthLines[index].followingColumn * 8, 1);
  });

  const attributes = page.locator("#attribute-target [aria-label='Terminal playback']");
  await expect(attributes).toContainText("ID");
  const colors = await attributes.evaluate((element) => {
    const textElements = Array.from(element.querySelectorAll<HTMLElement>("div"))
      .filter((candidate) => candidate.textContent === "I" || candidate.textContent === "D");
    return Object.fromEntries(textElements.map((candidate) => {
      const style = getComputedStyle(candidate);
      return [candidate.textContent!, { foreground: style.color, background: style.backgroundColor }];
    }));
  });
  expect(colors.I).toEqual(nativeVTReference.nativeAttributeColors.inverseRedOnBlue);
  expect(colors.D).toEqual(nativeVTReference.nativeAttributeColors.faintRedOnBlue);
});

test("supports native keyboard activation and seeking", async ({ page }) => {
  await page.goto("/src/test/visual/terminal-image.html");
  const player = page.locator("#keyboard-target");
  const play = player.getByRole("button", { name: "Play recording" });
  await play.focus();
  await play.press("Space");
  await expect(player.getByRole("button", { name: "Pause recording" })).toBeFocused();
  await player.getByRole("button", { name: "Pause recording" }).press("Enter");
  await expect(player.getByRole("button", { name: "Play recording" })).toBeFocused();

  const position = player.getByRole("slider", { name: "Playback position" });
  await position.focus();
  const before = Number(await position.inputValue());
  await position.press("ArrowRight");
  expect(Number(await position.inputValue())).toBe(before + 1);
});
