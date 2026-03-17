export const PLAN_LIMITS = {
  free:     { urls: 3,   checkFreqMinutes: 1440 }, // daily
  starter:  { urls: 25,  checkFreqMinutes: 1440 }, // daily
  pro:      { urls: 100, checkFreqMinutes: 60   }, // hourly
  business: { urls: 500, checkFreqMinutes: 15   }, // 15 min
};
