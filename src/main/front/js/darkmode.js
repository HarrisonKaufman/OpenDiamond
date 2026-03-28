
(function() {
  const DARK_MODE_KEY = 'darkmode-enabled';
  
  function initDarkMode() {
    const isDarkMode = localStorage.getItem(DARK_MODE_KEY) === 'true';
    if (isDarkMode) {
      enableDarkMode();
    }
    
    const toggleBtn = document.getElementById('darkModeToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleDarkMode);
    }
  }
  
  function toggleDarkMode() {
    const isDarkMode = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    if (isDarkMode) {
      disableDarkMode();
    } else {
      enableDarkMode();
    }
  }
  
  function enableDarkMode() {
    document.documentElement.setAttribute('data-bs-theme', 'dark');
    document.body.classList.add('dark-mode');
    localStorage.setItem(DARK_MODE_KEY, 'true');
    updateToggleButton(true);
  }
  
  function disableDarkMode() {
    document.documentElement.removeAttribute('data-bs-theme');
    document.body.classList.remove('dark-mode');
    localStorage.setItem(DARK_MODE_KEY, 'false');
    updateToggleButton(false);
  }
  
  function updateToggleButton(isDark) {
    const toggleBtn = document.getElementById('darkModeToggle');
    if (toggleBtn) {
      const icon = toggleBtn.querySelector('i');
      if (icon) {
        if (isDark) {
          icon.className = 'bi bi-sun-fill';
          toggleBtn.setAttribute('title', 'Switch to Light Mode');
        } else {
          icon.className = 'bi bi-moon-fill';
          toggleBtn.setAttribute('title', 'Switch to Dark Mode');
        }
      }
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDarkMode);
  } else {
    initDarkMode();
  }
})();

