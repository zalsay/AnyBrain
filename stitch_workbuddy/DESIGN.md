# Design System Document

## 1. Overview & Creative North Star: "The Neon Monolith"

This design system is built to transform a functional AI productivity platform into a high-end, editorial digital experience. Our Creative North Star is **"The Neon Monolith"**—a concept that blends the structural weight of brutalist architecture with the ethereal, high-tech glow of a futuristic laboratory. 

We move beyond the "template" look by favoring intentional asymmetry over rigid grids. By utilizing deep, ink-black backgrounds (#0D0D0D) contrasted with electric primary accents (#00e38a), we create a space where content feels curated and prioritized. This isn't just a dashboard; it’s a command center. We achieve premium quality through tonal depth, high-contrast typography, and the total elimination of standard 1px borders in favor of atmospheric layering.

---

## 2. Colors

The palette is anchored in absolute darkness, using subtle variations in "Surface" tones to define space without relying on intrusive lines.

*   **Background (`#0e0e0e`)**: The foundation. All main workspaces live here.
*   **Primary (`#00e38a`)**: Our signature "Neon." Used sparingly for high-value actions, status indicators, and active states.
*   **Surface Hierarchy (The Nesting Rule)**: 
    *   `surface_container_lowest`: Use for the main command bar background.
    *   `surface_container_low`: Standard sidebar background.
    *   `surface_container_high`: Hover states and active navigation items.
*   **The "No-Line" Rule**: Explicitly prohibit 1px solid borders for sectioning. Boundaries must be defined solely through background color shifts. For example, the Sidebar (`surface_container_low`) sits directly against the Workspace (`background`) with no divider.
*   **The "Glass & Gradient" Rule**: Floating elements like tooltips or the central wireframe mascot background should utilize `surface_bright` with a 20px backdrop-blur. 
*   **Signature Textures**: CTAs should use a subtle linear gradient from `primary` to `primary_container` (135°) to give them a "machined" metallic sheen.

---

## 3. Typography

Our typography scales are designed to feel like a high-end tech journal.

*   **Display & Headlines (Space Grotesk)**: This is our architectural voice. The wide, geometric stance of Space Grotesk conveys authority. Use `display-lg` for hero statements like "Claw Your Ideas Into Reality."
*   **Titles & Body (Manrope)**: Chosen for its extreme legibility and modern proportions. Use `title-md` for sidebar navigation items (专家, 技能) to ensure they feel grounded.
*   **Labels (Inter)**: High-precision, functional text. Used for metadata and the command bar's utility buttons (文档处理).
*   **Editorial Contrast**: Always pair a large `display-sm` heading with a significantly smaller `body-md` sub-text. The vast jump in scale creates the "premium" editorial feel.

---

## 4. Elevation & Depth

We eschew "Material" shadows for "Tonal Layering." Hierarchy is felt through the "glow" of light and the weight of darkness.

*   **The Layering Principle**: Depth is achieved by stacking. Place a `surface_container_highest` card on top of a `surface_container_low` section. This creates a soft, natural lift.
*   **Ambient Shadows**: When a floating command bar requires a shadow, use a 40px blur with 6% opacity, tinted with `primary_dim` to simulate the green neon light reflecting off the surface.
*   **The "Ghost Border" Fallback**: If a container needs more definition (e.g., input fields), use the `outline_variant` token at 15% opacity. Never use 100% opaque borders.
*   **Glassmorphism**: The central mascot area should feel like a holographic projection. Use `surface_variant` with 40% opacity and a `backdrop-blur` of 12px to allow the deep background to bleed through.

---

## 5. Components

### Buttons & Chips
*   **Primary Action**: Rounded `xl` (1.5rem). Background is a gradient of `primary` to `primary_dim`. Text is `on_primary`.
*   **Quick Action Chips (Command Bar)**: Use `surface_container_highest`. No border. Transition to `primary_container` on hover. Use `label-md` for the Chinese labels.

### Input Fields (The Command Bar)
*   **Style**: A single, wide capsule (`rounded-full`) using `surface_container_low`. 
*   **States**: On focus, do not use a border. Instead, apply a soft inner-glow using the `primary` color at 10% opacity.

### Sidebar Navigation
*   **Active State**: Use `primary_container` as the background with a `primary` vertical "pip" (2px wide) on the far left. 
*   **Spacing**: Use `spacing-4` (1rem) between items to ensure the layout feels airy and un-cramped.

### Lists (Workspace Section)
*   **Rule**: Forbid divider lines. Separate items like "每周自动生成周报..." using `spacing-2` vertical margins and a subtle shift to `surface_container_low` for the hovered item.

---

## 6. Do's and Don'ts

### Do's
*   **DO** use asymmetry. If the sidebar is heavy, keep the hero section centered with vast negative space.
*   **DO** preserve the original Chinese labels (专家, 技能, 自动化) using `title-sm` to maintain functional familiarity.
*   **DO** use the `rounded-xl` scale for all main containers to soften the dark aesthetic.

### Don'ts
*   **DON'T** use pure white (#FFFFFF). Always use `on_surface` (#e7e5e4) to prevent eye strain on the dark background.
*   **DON'T** use 1px dividers. If you feel the need for a line, use a 12px vertical gap (`spacing-3`) instead.
*   **DON'T** mix font families outside of the defined Scale. Space Grotesk is for headers; Manrope is for content. No exceptions.