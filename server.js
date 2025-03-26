const axios = require('axios');
const fs = require('fs').promises;

const BASE_URL = 'http://35.207.196.198:8000';
const VERSIONS = ['v1', 'v2', 'v3'];  //change here for particular version you want
const INITIAL_DELAY = 1000;
const MAX_RETRY_DELAY = 60000;

class VersionExtractor {
  constructor(version) {
    this.version = version;
    this.totalAttempts = 0;
    this.successfulRequests = 0;
    this.rateLimitedRequests = 0;
    this.allNames = new Set();
    this.startTime = Date.now();
    this.requests = []; 

    switch (version) {
      case 'v1':
        this.threshold = 10;
        this.rateLimit = 100;
        break;
      case 'v2':
        this.threshold = 12;
        this.rateLimit = 50;
        break;
      case 'v3':
        this.threshold = 15;
        this.rateLimit = 80;
        break;
      default:
        this.threshold = 15;
        this.rateLimit = 100;
    }
  }

  getParams(query) {
    return { query: query };
  }

  getResultsFromResponse(response) {
    return response.data.results || [];
  }

 getChars() {
    switch (this.version) {
      case 'v1': return 'abcdefghijklmnopqrstuvwxyz';
      case 'v2': return '0123456789abcdefghijklmnopqrstuvwxyz';
      case 'v3': return '+-.0123456789abcdefghijklmnopqrstuvwxyz ';
      default: return 'abcdefghijklmnopqrstuvwxyz';
    }
  }

  async waitForRateLimit() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t <= 60000);

    while (this.requests.length >= this.rateLimit) {
      const oldest = this.requests[0];
      const waitTime = 60000 - (now - oldest) + 1; 
      console.log(`[${this.version}] Rate limit reached. Waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      const newNow = Date.now();
      this.requests = this.requests.filter(t => newNow - t <= 60000);
    }

    this.requests.push(Date.now());
  }

  async queryAutocomplete(query, retryCount = 0) {
    const attemptNumber = this.totalAttempts + 1;
    this.totalAttempts++;
    
    try {
      await this.waitForRateLimit();

      const timestamp = new Date().toISOString().substr(11, 8);
      console.log(`[${timestamp}][${this.version}] Attempt #${attemptNumber} (${retryCount > 0 ? `retry ${retryCount}` : 'initial'}): ${query}`);

      const response = await axios.get(`${BASE_URL}/${this.version}/autocomplete`, {
        params: this.getParams(query),
        timeout: 5000
      });

      const results = this.getResultsFromResponse(response);
      
      this.successfulRequests++;
      console.log(`[${timestamp}][${this.version}] SUCCESS: ${query} => ${results.length} results`);
      return results;
    } catch (error) {
      if (error.response?.status === 429) {
        this.rateLimitedRequests++;
        const baseDelay = Math.min(MAX_RETRY_DELAY, INITIAL_DELAY * Math.pow(2, retryCount));
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;

        console.log(`[${this.version}] RATE LIMITED: ${query} | Retry ${retryCount + 1} in ${(delay/1000).toFixed(1)}s`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.queryAutocomplete(query, retryCount + 1);
      }
      
      console.error(`[${this.version}] ERROR: ${query} | ${error.message}`);
      return [];
    }
  }

  async explorePrefix(prefix) {
    const results = await this.queryAutocomplete(prefix);

    results.forEach(name => this.allNames.add(name));
    
    if (results.length >= this.threshold) {
      console.log(`[${this.version}] EXPANDING: ${prefix}*`);
      for (const char of this.getChars()) {
       if (this.version === 'v3' && char === ' ' && prefix.endsWith(' ')) {
          continue;
      }
        await this.explorePrefix(prefix + char);
      }
    }
  }

  async extractNames() {
    console.log(`\n=== STARTING ${this.version} EXTRACTION ===`);
    const timer = setInterval(() => {
      const elapsed = ((Date.now() - this.startTime)/1000).toFixed(1);
      console.log([
        `[${this.version}] PROGRESS UPDATE`,
        `Elapsed: ${elapsed}s`,
        `Names: ${this.allNames.size}`,
        `Attempts: ${this.totalAttempts}`,
        `Success: ${this.successfulRequests}`,
        `Rate Limited: ${this.rateLimitedRequests}`
      ].join(' | '));
    }, 5000);

    try {
      const initialChars = this.getChars();
      for (const char of initialChars) {
        if (this.version === 'v3' && char === ' ') 
          continue;
        await this.explorePrefix(char);
      }

      const namesArray = Array.from(this.allNames).sort();
      await fs.writeFile(`${this.version}_names.json`, JSON.stringify(namesArray, null, 2));

      console.log(`\n=== COMPLETED ${this.version} ===`);
      console.log(`Total Time: ${((Date.now() - this.startTime)/1000).toFixed(1)}s`);
      console.log(`Total Attempts: ${this.totalAttempts}`);
      console.log(`Successful Requests: ${this.successfulRequests}`);
      console.log(`Rate Limited Requests: ${this.rateLimitedRequests}`);
      console.log(`Unique Names Found: ${this.allNames.size}`);

      return {
        attempts: this.totalAttempts,
        successes: this.successfulRequests,
        rateLimited: this.rateLimitedRequests,
        names: this.allNames.size
      };
    } finally {
      clearInterval(timer);
    }
  }
}

async function main() {
  const results = {
    v1: { requestCount: 0, resultCount: 0, error: 'Not processed' },
    v2: { requestCount: 0, resultCount: 0, error: 'Not processed' },
    v3: { requestCount: 0, resultCount: 0, error: 'Not processed' },
  };

  for (const version of VERSIONS) {
    console.log(`\n=== Testing ${version} endpoint ===`);
    const extractor = new VersionExtractor(version);
    
    try {
      const testParams = extractor.getParams('test');
      const test = await axios.get(`${BASE_URL}/${version}/autocomplete`, {
        params: testParams,
        timeout: 5000
      });
      console.log(`[${version}] Endpoint OK (Status: ${test.status})`);
      
      const extractResult = await extractor.extractNames();
      results[version] = {
        requestCount: extractResult.attempts,
        resultCount: extractResult.names,
        error: null
      };
    } catch (error) {
      console.log(`[${version}] Endpoint unavailable: ${error.message}`);
      results[version] = {
        requestCount: 0,
        resultCount: 0,
        error: 'Endpoint not available'
      };
    }
  }

  console.log('\n=== Final Results ===');
  VERSIONS.forEach(version => {
    console.log(`\nVersion ${version}:`);
    console.log(`- Requests: ${results[version].requestCount}`);
    console.log(`- Results: ${results[version].resultCount}`);
    if (results[version].error) console.log(`- Error: ${results[version].error}`);
  });

  await fs.writeFile('answers.json', JSON.stringify({
    v1_requests: results.v1.requestCount,
    v2_requests: results.v2.requestCount,
    v3_requests: results.v3.requestCount,
    v1_results: results.v1.resultCount,
    v2_results: results.v2.resultCount,
    v3_results: results.v3.resultCount
  }, null, 2));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
