const getISOWeekNumber = (dateInput = new Date()) => {
  const date = new Date(dateInput.getTime());
  date.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year.
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNumber = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return { weekNumber, year: date.getFullYear() };
};

const isTuesday = (dateInput = new Date()) => {
  // Convert to Asia/Jakarta timezone string
  const jktString = dateInput.toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
  const jktDate = new Date(jktString);
  return jktDate.getDay() === 2; // 0=Sun, 1=Mon, 2=Tue, etc.
};

const getJakartaDateString = (dateInput = new Date()) => {
  const jktString = dateInput.toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
  const jktDate = new Date(jktString);
  const year = jktDate.getFullYear();
  const month = String(jktDate.getMonth() + 1).padStart(2, '0');
  const day = String(jktDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

module.exports = {
  getISOWeekNumber,
  isTuesday,
  getJakartaDateString
};
