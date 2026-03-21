export const PLAN_LIMITS = {
  free:     { urls: 3,   checkFreqMinutes: 1440, stockCheck: true,  stockFreqMinutes: 1440, smsAlerts: false, slackAlerts: false, headlessScraper: false, playwrightScraper: false, historyDays: 7   }, // daily
  starter:  { urls: 50,  checkFreqMinutes: 60,   stockCheck: true,  stockFreqMinutes: 60,   smsAlerts: false, slackAlerts: false, headlessScraper: false, playwrightScraper: false, historyDays: 30  }, // hourly
  pro:      { urls: 100, checkFreqMinutes: 60,   stockCheck: true,  stockFreqMinutes: 60,   smsAlerts: false, slackAlerts: false, headlessScraper: true,  playwrightScraper: true,  historyDays: 90  }, // hourly
  business: { urls: 250, checkFreqMinutes: 15,   stockCheck: true,  stockFreqMinutes: 15,   smsAlerts: false, slackAlerts: true,  headlessScraper: true,  playwrightScraper: true,  historyDays: 365 }, // 15 min
};
