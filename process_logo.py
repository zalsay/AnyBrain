import subprocess
from PIL import Image, ImageDraw

def create_squircle_mask(size, radius_ratio=0.22):
    """
    Creates a macOS-style squircle mask.
    The squircle formula is roughly (x/a)^4 + (y/b)^4 = 1,
    but a simple rounded rectangle is a good approximation for standard usage if we don't need perfect pixel-match to system icons.
    However, Apple's squircle is a bit more complex. Let's use a standard rounded rectangle with high quality.
    
    Standard macOS icon corner radius is ~22.5% of the size.
    For 1024px, radius is ~230px.
    """
    width, height = size
    mask = Image.new('L', size, 0)
    draw = ImageDraw.Draw(mask)
    
    # Rounded rectangle
    # Radius ~ 22% of width
    radius = int(min(width, height) * radius_ratio)
    
    # Draw rounded rectangle
    draw.rounded_rectangle([(0, 0), (width, height)], radius=radius, fill=255)
    
    return mask

def process_logo(input_path, output_path):
    try:
        # Open image
        with Image.open(input_path) as img:
            # Convert to RGBA
            img = img.convert("RGBA")
            
            # Target size 1024x1024
            target_size = (1024, 1024)
            
            # 1. Create outer background with 15% opacity (white)
            outer_bg = Image.new("RGBA", target_size, (255, 255, 255, int(255 * 0.15)))
            
            # 2. Resize logo to be slightly smaller than the background (e.g. 80% of target size)
            logo_size = (int(target_size[0] * 0.8), int(target_size[1] * 0.8))
            img_resized = img.resize(logo_size, Image.Resampling.LANCZOS)
            
            # 3. Create inner squircle mask for the logo itself
            inner_mask = create_squircle_mask(logo_size)
            
            # 4. Apply inner mask to resized logo
            logo_with_corners = Image.new("RGBA", logo_size, (0, 0, 0, 0))
            logo_with_corners.paste(img_resized, (0, 0), mask=inner_mask)
            
            # 5. Paste rounded logo onto center of outer_bg
            offset = ((target_size[0] - logo_size[0]) // 2, (target_size[1] - logo_size[1]) // 2)
            outer_bg.paste(logo_with_corners, offset, mask=logo_with_corners)
            
            # 6. Create final squircle mask for the entire icon
            final_mask = create_squircle_mask(target_size)
            
            # 7. Apply final mask to the result
            result = Image.new("RGBA", target_size, (0, 0, 0, 0))
            result.paste(outer_bg, (0, 0), mask=final_mask)
            
            # Save
            result.save(output_path, "PNG")
            print(f"Successfully saved processed logo to {output_path}")
            
            # 8. Run tauri icon command to generate all app icons
            print(f"Generating Tauri icons from {output_path}...")
            try:
                subprocess.run(["npm", "run", "tauri", "icon", "--", output_path], check=True)
                print("Successfully generated all Tauri icons.")
            except subprocess.CalledProcessError as e:
                print(f"Error generating Tauri icons: {e}")
            except FileNotFoundError:
                print("Error: 'npm' command not found. Please ensure Node.js is installed.")
            
    except Exception as e:
        print(f"Error processing image: {e}")
        exit(1)

if __name__ == "__main__":
    input_file = "logo.png"
    output_file = "app-icon.png"
    process_logo(input_file, output_file)
