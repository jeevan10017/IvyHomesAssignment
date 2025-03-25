const axios = require('axios');
const fs = require('fs').promises;

const BASE_URL = 'http://35.200.185.69:8000';
const VERSIONS = ['v1', 'v2', 'v3'];
const INITIAL_DELAY = 1000;
const MAX_RETRY_DELAY = 100000;
const RESULT_THRESHOLD = 10;

class VersionExtractor {
  constructor(version) {
    this.version = version;
    this.totalAttempts = 0;
    this.successfulRequests = 0;
    this.rateLimitedRequests = 0;
    this.allNames = new Set();
    this.startTime = Date.now();
  }

  getParams(query) {
    return { query: query };
  }

  getResultsFromResponse(response) {
    return response.data.results || [];
  }

  getChars() {
    switch (this.version) {
      case 'v1': return 'abcdefghijklmnopqrstuvwxyz0123456789';
      case 'v2': return 'abcdefghijklmnopqrstuvwxyz';
      case 'v3': return 'abcdefghijklmnopqrstuvwxyz0123456789 +-._';
      default: return 'abcdefghijklmnopqrstuvwxyz0123456789';
    }
  }

  async queryAutocomplete(query, retryCount = 0) {
    const attemptNumber = this.totalAttempts + 1;
    this.totalAttempts++;
    
    try {
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
    
    if (results.length >= RESULT_THRESHOLD) {
      console.log(`[${this.version}] EXPANDING: ${prefix}*`);
      for (const char of this.getChars()) {
        if (this.version === 'v3' && prefix.includes(' ') && char === ' ') {
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
  const results = {};
  
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

  await fs.writeFile('answers.json', JSON.stringify(results, null, 2));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
