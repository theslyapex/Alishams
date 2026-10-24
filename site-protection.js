/* Site-wide deterrent against casual image copying. This cannot stop screenshots, developer tools, or direct asset URLs. */
(function(){
  if (window.__alishamsProtectionLoaded) return;
  window.__alishamsProtectionLoaded = true;
  const style = document.createElement('style');
  style.textContent = 'img, picture, video { -webkit-user-drag: none !important; user-drag: none !important; -webkit-user-select: none !important; user-select: none !important; }';
  (document.head || document.documentElement).appendChild(style);
  document.addEventListener('contextmenu', function(event){ event.preventDefault(); }, true);
  document.addEventListener('dragstart', function(event){
    if (event.target && event.target.closest && event.target.closest('img, picture, video, audio')) event.preventDefault();
  }, true);
  document.addEventListener('copy', function(event){
    const selection = window.getSelection && window.getSelection();
    const target = event.target;
    const imageTarget = target && target.closest && target.closest('img, picture, video, canvas');
    const imageSelection = selection && selection.anchorNode && (
      (selection.anchorNode.nodeType === 1 && selection.anchorNode.closest && selection.anchorNode.closest('img, picture, video, canvas')) ||
      (selection.anchorNode.parentElement && selection.anchorNode.parentElement.closest && selection.anchorNode.parentElement.closest('img, picture, video, canvas'))
    );
    if (imageTarget || imageSelection) event.preventDefault();
  }, true);
  document.addEventListener('cut', function(event){
    if (event.target && event.target.closest && event.target.closest('img, picture, video, canvas')) event.preventDefault();
  }, true);
})();
