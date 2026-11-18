# ClipFlow design system

ClipFlow is a professional personal creator studio. The operational flow is **import → prepare → review → publish**. Overview is the homepage. Real video thumbnails are the main visual content once the library has videos; zero states use a Phosphor icon and explain what appears there.

## Theme tokens

CSS custom properties in `src/app/globals.css` are the source of truth. Keep neutral surfaces, monochrome primary actions, and single weight Phosphor icons. Violet is reserved for AI controls and suggestions. Use flat backgrounds and real uploads for media previews.

| Token | Light | Dark |
| --- | --- | --- |
| Background | `#F7F7F7` | `#181818` |
| Surface | `#FFFFFF` | `#1F1F1F` |
| Elevated surface | `#F0F0F0` | `#272727` |
| Border | `#E5E5E5` | `#343434` |
| Primary action | `#181818` | `#F5F5F5` |
| Primary text | `#171717` | `#FAFAFA` |
| Secondary text | `#666666` | `#A3A3A3` |
| Action text | `#FFFFFF` | `#181818` |

Functional references are success `#22C55E`, warning `#F59E0B`, error `#EF4444`, active and scheduled `#3B82F6`, AI `#A855F7`, YouTube `#FF0033`, and Instagram `#D946A0`. Use the reusable `Status` component and semantic classes for theme specific text, subtle backgrounds, and a labeled dot. Use gray for drafts and unavailable values. Account and queue flags use the same colors in both themes. Preserve accessible text and focus contrast.

## Typography, layout, and interaction

- Manrope for the interface; Geist Mono with tabular numerals for counts, times, identifiers, and durations. Fonts are bundled locally. Use Heading 4 for page titles (30/36, 600), Dashboard Section for section titles (18/28, 600), Body 6 (14/20, 400), Button UI (14/20, 500), and Caption styles (12/16) for metadata. Use balanced headings, pretty paragraph wrapping, and sentence case. Avoid italics and ultra bold.
- Desktop sidebar is 248 px expanded and 64 px collapsed. Header is 64 px. Main desktop padding is 24 to 32 px. Use the approved spacing scale of 4, 8, 12, 16, 24, 32, and 48 px. Cards use a 12 px radius, controls 8 px, and tighter insets 4 px. Cards have a full border; row and shell dividers are separate structural rules.
- Keep light, dark, and system preferences. Use the same icon weight in controls. Give enabled controls hover, active, and visible keyboard focus states. The drawer traps focus, supports Escape, and returns focus to its trigger. Use restrained 200 ms transform or opacity transitions with `cubic-bezier(0.22, 1, 0.36, 1)`; remove movement for reduced motion.
- At 390 px, keep both primary actions visible, prevent horizontal overflow, reflow metrics into two columns and detail panels into one, and use the accessible navigation drawer. Use real clip thumbnails with appropriate text alternatives once media is available.
- Render specific inline errors, content shaped loading skeletons, and contextual empty states when features start reading real data. Planned features stay visibly unavailable until they work. Keep the skip link, branded favicon and 404, page metadata, semantic landmarks, and active navigation state.
- Library cards use frames from uploaded videos. Upload states distinguish transfer, analysis, success, and failure in text. Pending analysis uses a neutral thumbnail placeholder.
- The wizard highlights one step at a time and keeps saving available throughout. Calendar distinguishes local plans from runnable jobs. Analytics uses flat monochrome plots only for reported data, with gaps preserved and a text alternative. Separate channel totals from selected period metrics.

## Applying the landing page skill

Use the installed skill for token consistency, accessible interaction, realistic product copy, and visual review. The approved 18 px semibold section style and 14 px medium button style override the skill's weight pairings. The approved monochrome sidebar and opaque mobile drawer replace marketing navigation and blur. The local dashboard also omits acquisition copy, hero gradients, scroll reveals, tagline animation, SEO acquisition content, social sharing previews, and marketing footer links. Keep dashboard pages out of search indexes. Revisit provider required policy disclosures during OAuth setup.
