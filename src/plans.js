export const PLAN_LIMITS = {
  free:     { urls: 3,   checkFreqMinutes: 1440, stockCheck: true,  stockFreqMinutes: 1440, smsAlerts: false, slackAlerts: false, headlessScraper: false, playwrightScraper: false }, // daily
  starter:  { urls: 25,  checkFreqMinutes: 1440, stockCheck: true,  stockFreqMinutes: 1440, smsAlerts: false, slackAlerts: false, headlessScraper: false, playwrightScraper: false }, // daily
  pro:      { urls: 100, checkFreqMinutes: 60,   stockCheck: true,  stockFreqMinutes: 60,   smsAlerts: true,  slackAlerts: false, headlessScraper: true,  playwrightScraper: true  }, // hourly
  business: { urls: 500, checkFreqMinutes: 5,    stockCheck: true,  stockFreqMinutes: 5,    smsAlerts: true,  slackAlerts: true,  headlessScraper: true,  playwrightScraper: true  }, // 5 min
};
