let colors = [];

function loadColors() {
  chrome.storage.sync.get('highlightColors', (data) => {
    colors = data.highlightColors || ['red', 'yellow', 'green'];
    renderColorOptions();
  });
}

function renderColorOptions() {
  const colorOptionsDiv = document.getElementById('colorOptions');
  colorOptionsDiv.innerHTML = '';
  colors.forEach((color, index) => {
    const colorOption = document.createElement('div');
    colorOption.className = 'color-option';
    colorOption.innerHTML = `
      <input type="color" value="${color}" data-index="${index}">
      <button class="remove-color" data-index="${index}">删除</button>
    `;
    colorOptionsDiv.appendChild(colorOption);
  });
}

document.getElementById('addColor').addEventListener('click', () => {
  colors.push('#000000');
  renderColorOptions();
});

document.getElementById('save').addEventListener('click', () => {
  const colorInputs = document.querySelectorAll('input[type="color"]');
  colors = Array.from(colorInputs).map(input => input.value);
  chrome.storage.sync.set({highlightColors: colors}, () => {
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

loadColors();