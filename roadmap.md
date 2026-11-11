# Roadmap

## Open
- Space-bar pause/unpause replays the destination circle and click ripple each time — should only play when landing on a new step.

## Done
- Destination circle appears on landing a step, then fades away after ~1.5s instead of lingering.
- Drawn cursor stays hidden for the first half of a glide so it doesn't double up with the screenshot's real cursor at the path start.
- Cursor destination: a circle (not a box), shown only when the destination element has no bounding box to highlight.
- Clicking play leaves the timeline and inspector panels exactly as the user left them (open or closed).
- Detail pane keeps showing the last step's info between actions instead of flashing blank.
- Step and console rows no longer show the "page@hash" suffix.
- Inspector panel no longer resizes during playback (the detail toggle's row stays on screen for every step).
- In stacked mode the detail toggle sits at the left edge, clear of the centered timeline toggle.
- Detail toggle is always visible; when expanded it stays open even on steps with no detail data (blank panel).
- Full test suite green: 169/169.

## Done
- Eject in the wide toolbar is icon-only (no "Eject" word); the name stays in its tooltip and accessible label.
- Highlight (flashlight) moved from the far right of the wide toolbar into the playback-options group, right after Sound; layout and theme stay on the right.
- Time readout moves into the overflow "⋯" menu when the toolbar is extremely narrow (it is the last thing to leave; the menu row shows the live time).
- Toolbar option icons now match the menu icons (lucide: Repeat, Flashlight, Columns2/Rows3, Sun/Moon, LogOut) instead of text glyphs.
- Sound option is always shown in the toolbar, even when the recording has no audio.
- Eject moves into the overflow "⋯" menu when the toolbar gets narrow (second to last to leave).
- Embedded players hide the dark/light toggle, like eject. Eject placement stays as is (left of the theme toggle).
