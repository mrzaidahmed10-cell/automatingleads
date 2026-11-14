(function () {
  var d = document.documentElement;
  try {
    var t = localStorage.getItem('theme');
    if (!t) t = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    d.dataset.theme = t === 'dark' ? 'dark' : 'light';
    d.dataset.fx = localStorage.getItem('fx') === 'calm' ? 'calm' : 'full';
    d.dataset.density = localStorage.getItem('density') === 'comfy' ? 'comfy' : 'compact';
  } catch (e) {
    d.dataset.theme = 'light';
    d.dataset.density = 'compact';
  }
})();
