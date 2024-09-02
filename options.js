let colors = [];
const MAX_COLORS = 9;
const DEFAULT_OPACITY = 0.4;

function loadColors() {
  chrome.storage.sync.get('highlightColors', (data) => {
    colors = data.highlightColors || [
      { color: '#FF809D', opacity: DEFAULT_OPACITY },
      { color: '#FCF485', opacity: DEFAULT_OPACITY },
      { color: '#C5FB72', opacity: DEFAULT_OPACITY },
      { color: '#38E5FF', opacity: DEFAULT_OPACITY }
    ];
    renderColorOptions();
  });
}

function renderColorOptions() {
  const colorOptionsDiv = document.getElementById('colorOptions');
  colorOptionsDiv.innerHTML = '';
  colors.forEach((colorObj, index) => {
    const colorOption = document.createElement('div');
    colorOption.className = 'color-option';
    colorOption.innerHTML = `
      <label>颜色 ${index + 1}</label>
      <div class="color-input">
        <input type="color" value="${colorObj.color}" data-index="${index}">
        <input type="text" value="${colorObj.color}" data-index="${index}">
      </div>
      <div class="opacity-control">
        <label>透明度：</label>
        <input type="range" min="0" max="1" step="0.1" value="${colorObj.opacity}" data-index="${index}">
        <span class="opacity-value">${Math.round(colorObj.opacity * 100)}%</span>
      </div>
      <button class="remove-color" data-index="${index}">删除</button>
    `;
    colorOptionsDiv.appendChild(colorOption);
  });

  document.getElementById('addColor').disabled = colors.length >= MAX_COLORS;
}

document.getElementById('addColor').addEventListener('click', () => {
  if (colors.length < MAX_COLORS) {
    colors.push({ color: '#000000', opacity: DEFAULT_OPACITY });
    renderColorOptions();
  }
});

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.sync.set({ highlightColors: colors }, () => {
    alert('颜色已保存');
  });
});

document.getElementById('colorOptions').addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-color')) {
    const index = parseInt(e.target.dataset.index);
    colors.splice(index, 1);
    renderColorOptions();
  }
});

document.getElementById('colorOptions').addEventListener('input', (e) => {
  const index = parseInt(e.target.dataset.index);
  if (e.target.type === 'color') {
    colors[index].color = e.target.value;
    e.target.nextElementSibling.value = e.target.value;
  } else if (e.target.type === 'text') {
    const colorInput = e.target.previousElementSibling;
    if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
      colors[index].color = e.target.value;
      colorInput.value = e.target.value;
    }
  } else if (e.target.type === 'range') {
    colors[index].opacity = parseFloat(e.target.value);
    const opacitySpan = e.target.nextElementSibling;
    opacitySpan.textContent = `${Math.round(e.target.value * 100)}%`;
  }
});

function hexToRGBA(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

loadColors();