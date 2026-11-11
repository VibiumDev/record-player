# Roadmap

## Open
- Cursor destination: a circle (not a box), shown only when the destination element has no bounding box to highlight.
- Clicking play must leave the timeline and inspector panels exactly as the user left them (open or closed).
- Inspector panel "bobs" up and down during playback in both stacked and side-by-side layouts — the step's extra-info toggle appears/disappears per step, resizing the panel.
- In stacked mode the extra-info toggle overlaps/collides with the timeline toggle — they need clear separation.
- 6 tests failing after the detail-pane and cursor changes — find the cause and fix. (Resolved: full suite 169/169 passing.)
- Detail toggle must always be visible (no flashing); expanding it on a step with no detail data shows an empty panel.

## Done
- Eject in the wide toolbar is icon-only (no "Eject" word); the name stays in its tooltip and accessible label.
- Highlight (flashlight) moved from the far right of the wide toolbar into the playback-options group, right after Sound; layout and theme stay on the right.
- Time readout moves into the overflow "⋯" menu when the toolbar is extremely narrow (it is the last thing to leave; the menu row shows the live time).
- Toolbar option icons now match the menu icons (lucide: Repeat, Flashlight, Columns2/Rows3, Sun/Moon, LogOut) instead of text glyphs.
- Sound option is always shown in the toolbar, even when the recording has no audio.
- Eject moves into the overflow "⋯" menu when the toolbar gets narrow (second to last to leave).
- Embedded players hide the dark/light toggle, like eject. Eject placement stays as is (left of the theme toggle).
