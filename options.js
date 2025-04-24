let colors = [];
const MAX_COLORS = 9;
const DEFAULT_OPACITY = 0.4; // Default opacity for new colors

// Helper function to convert hex and opacity to rgba string
function hexToRGBA(hex, opacity) {
    // Remove # if present
    hex = hex.startsWith('#') ? hex.slice(1) : hex;

    // Handle shorthand hex (e.g., #03F)
    if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }

    if (hex.length !== 6) {
        console.error("Invalid HEX color:", hex);
        return `rgba(0, 0, 0, ${opacity})`; // Return black with opacity on error
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    if (isNaN(r) || isNaN(g) || isNaN(b)) {
        console.error("Invalid HEX color conversion:", hex);
        return `rgba(0, 0, 0, ${opacity})`; // Return black with opacity on error
    }

    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Load colors from storage
function loadColors() {
    chrome.storage.sync.get('highlightColors', (data) => {
        colors = data.highlightColors || [
            { color: '#FF809D', opacity: 0.4 }, // Pinkish Red
            { color: '#FCF485', opacity: 0.4 }, // Yellow
            { color: '#C5FB72', opacity: 0.4 }, // Green
            { color: '#38E5FF', opacity: 0.4 }  // Blue
        ];
        // Ensure opacity exists for older formats if necessary
        colors = colors.map(c => ({
            color: c.color || '#000000', // Default to black if color missing
            opacity: typeof c.opacity === 'number' ? c.opacity : DEFAULT_OPACITY
        }));
        renderColorOptions();
    });
}

// Render the color options UI
function renderColorOptions() {
    const colorOptionsDiv = document.getElementById('colorOptions');
    colorOptionsDiv.innerHTML = ''; // Clear existing options

    colors.forEach((colorObj, index) => {
        const colorOption = document.createElement('div');
        colorOption.className = 'color-option';
        colorOption.innerHTML = `
      <label>颜色 ${index + 1} (快捷键: Alt+Shift+${index + 1})</label>
      <div class="color-input">
        <input type="color" value="${colorObj.color}" data-index="${index}" title="选择颜色">
        <input type="text" value="${colorObj.color}" data-index="${index}" placeholder="#RRGGBB" pattern="#?[0-9A-Fa-f]{6}" title="输入 6 位十六进制颜色 (#RRGGBB)">
      </div>
      <div class="opacity-control">
        <label for="opacity-range-${index}">透明度:</label>
        <input type="range" id="opacity-range-${index}" min="0.1" max="1" step="0.05" value="${colorObj.opacity}" data-index="${index}">
        <span class="opacity-value">${Math.round(colorObj.opacity * 100)}%</span>
      </div>
      <button class="remove-color" data-index="${index}" title="删除此颜色">删除</button>
    `;
        colorOptionsDiv.appendChild(colorOption);
    });

    // Disable "Add Color" button if max reached
    document.getElementById('addColor').disabled = colors.length >= MAX_COLORS;
    updateColorInputStyles(); // Update text input background
}

// Update text input background color to match color picker
function updateColorInputStyles() {
    const textInputs = document.querySelectorAll('.color-input input[type="text"]');
    textInputs.forEach(input => {
        const colorPicker = input.previousElementSibling;
        input.style.backgroundColor = colorPicker.value;
        // Set text color based on background brightness for readability
        try {
            const hex = colorPicker.value.slice(1);
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            // Formula for perceived brightness (adjust coefficients if needed)
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            input.style.color = brightness > 128 ? '#000000' : '#FFFFFF'; // Black text on light, white on dark
        } catch (e) {
             input.style.color = '#000000'; // Default to black on error
        }

    });
}


// Event listener for adding a new color
document.getElementById('addColor').addEventListener('click', () => {
    if (colors.length < MAX_COLORS) {
        // Add a default distinct color or cycle through some defaults
        const defaultNewColors = ["#FFA07A", "#98FB98", "#ADD8E6", "#FFB6C1", "#F0E68C"];
        const nextColor = defaultNewColors[colors.length % defaultNewColors.length] || '#000000';
        colors.push({ color: nextColor, opacity: DEFAULT_OPACITY });
        renderColorOptions();
    }
});

// Event listener for saving colors
document.getElementById('save').addEventListener('click', () => {
    // Ensure all color values are valid before saving
     const validColors = colors.every(c => /^#[0-9A-Fa-f]{6}$/i.test(c.color));
     if (!validColors) {
         alert('存在无效的颜色格式。请确保所有颜色均为 #RRGGBB 格式。');
         return;
     }

    chrome.storage.sync.set({ highlightColors: colors }, () => {
        alert(`颜色已保存 (${colors.length} 种)。`);
        // Optionally send a message to background/content scripts to update immediately
        chrome.runtime.sendMessage({ action: "colorsUpdated" }).catch(e => console.log("Could not send color update message:", e));
    });
});

// Event delegation for handling clicks within the color options area
document.getElementById('colorOptions').addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-color')) {
        if (colors.length <= 1) {
            alert("至少需要保留一种高亮颜色。");
            return;
        }
        const index = parseInt(e.target.dataset.index);
        if (!isNaN(index)) {
            colors.splice(index, 1);
            renderColorOptions(); // Re-render the UI
        }
    }
});

// Event delegation for handling input changes within the color options area
document.getElementById('colorOptions').addEventListener('input', (e) => {
    const index = parseInt(e.target.dataset.index);
    if (isNaN(index)) return; // Ignore if index is not valid

    const target = e.target;

    if (target.type === 'color') {
        // Update color object and the corresponding text input
        colors[index].color = target.value.toUpperCase();
        const textInput = target.nextElementSibling;
        if (textInput && textInput.type === 'text') {
            textInput.value = target.value.toUpperCase();
            updateColorInputStyles(); // Update text input style
        }
    } else if (target.type === 'text') {
        // Validate and update color object and the corresponding color input
        const colorPicker = target.previousElementSibling;
        let value = target.value.toUpperCase();
        if (!value.startsWith('#')) {
            value = '#' + value;
        }
        if (/^#[0-9A-F]{6}$/i.test(value)) {
            colors[index].color = value;
            if (colorPicker && colorPicker.type === 'color') {
                colorPicker.value = value;
            }
            target.value = value; // Ensure # is present and uppercase
             updateColorInputStyles(); // Update text input style
        } else {
            // Optional: Visual feedback for invalid input, e.g., red border
           // target.style.outline = "1px solid red";
        }
    } else if (target.type === 'range') {
        // Update opacity and the display span
        const opacity = parseFloat(target.value);
        colors[index].opacity = opacity;
        const opacitySpan = target.nextElementSibling; // Assumes span is directly after range
        if (opacitySpan && opacitySpan.classList.contains('opacity-value')) {
            opacitySpan.textContent = `${Math.round(opacity * 100)}%`;
        }
    }
});

// Initial load
loadColors();