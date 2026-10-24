/* Site-wide deterrent against casual text/image copying. This cannot stop screenshots, developer tools, or direct asset URLs. */
(function(){
  if (window.__alishamsProtectionLoaded) return;
  window.__alishamsProtectionLoaded = true;

  const style = document.createElement('style');
  style.textContent = `
    html, body, body * {
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-touch-callout: none !important;
    }
    input, textarea, select, option, [contenteditable="true"], [contenteditable=""] {
      -webkit-user-select: text !important;
      user-select: text !important;
      -webkit-touch-callout: default !important;
    }
    img, picture, video, canvas {
      -webkit-user-drag: none !important;
      user-drag: none !important;
      -webkit-user-select: none !important;
      user-select: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  const isEditable = function(target) {
    return !!(target && target.closest && target.closest('input, textarea, select, option, [contenteditable="true"], [contenteditable=""]'));
  };

  document.addEventListener('contextmenu', function(event){
    if (!isEditable(event.target)) event.preventDefault();
  }, true);

  document.addEventListener('selectstart', function(event){
    if (!isEditable(event.target)) event.preventDefault();
  }, true);

  document.addEventListener('dragstart', function(event){
    if (event.target && event.target.closest && event.target.closest('img, picture, video, audio, canvas')) event.preventDefault();
  }, true);

  document.addEventListener('copy', function(event){
    if (!isEditable(event.target)) event.preventDefault();
  }, true);

  document.addEventListener('cut', function(event){
    if (!isEditable(event.target)) event.preventDefault();
  }, true);
})();