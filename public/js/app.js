// Fallback compatibility wrapper in case app.js is requested directly or from cache
import('./main.js').catch(err => {
  console.error('Gagal memuat modul main.js dari app.js:', err);
});
