function formatNumber(value) {
  if (value === undefined || value === null) return 'N/A';
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(3);
}

function showError(message) {
  const errorDiv = document.getElementById('errorMessage');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  document.getElementById('loading').style.display = 'none';
  document.getElementById('playerInfo').style.display = 'none';
}

function hideError() {
  document.getElementById('errorMessage').style.display = 'none';
}
