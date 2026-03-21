export const PLAN_LIMITS = {
  free:     { urls: 3,   checkFreqMinutes: 1440, stockCheck: true,  stockFreqMinutes: 1440, smsAlerts: false, slackAlerts: false, headlessScraper: false }, // daily
  starter:  { urls: 25,  checkFreqMinutes: 1440, stockCheck: true,  stockFreqMinutes: 1440, smsAlerts: false, slackAlerts: false, headlessScraper: false }, // daily
  pro:      { urls: 100, checkFreqMinutes: 60,   stockCheck: true,  stockFreqMinutes: 60,   smsAlerts: true,  slackAlerts: false, headlessScraper: true  }, // hourly
  business: { urls: 500, checkFreqMinutes: 15,   stockCheck: true,  stockFreqMinutes: 15,   smsAlerts: true,  slackAlerts: true,  headlessScraper: true  }, // 15 min
};
