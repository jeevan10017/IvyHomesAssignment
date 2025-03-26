# IvyHomesAssignment

## Overview

This solution extracts all possible names from an autocomplete API with three versions (v1, v2, v3) while handling rate limiting and API constraints. The code uses recursive prefix exploration with adaptive thresholds and rate limit management.

## Key Features

- Version-specific handling for API parameters and character sets
- Dynamic rate limit management with sliding window tracking
- Recursive prefix expansion based on response thresholds
- Progress tracking and statistics reporting
- Automatic result deduplication and sorting

## API Discoveries

### Endpoints

- `/v1/autocomplete?query=<string>`
- `/v2/autocomplete?query=<string>`
- `/v3/autocomplete?query=<string>`

### Version Characteristics

| Version | Rate Limit | Threshold | Valid Characters |
|---------|------------|-----------|-----------------|
| v1      | 100/min    | 10        | a-z             |
| v2      | 50/min     | 12        | a-z0-9          |
| v3      | 80/min     | 15        | a-z0-9 +-._ (no consecutive spaces) |

## Challenges & Solutions

### 1. Rate Limiting

**Problem:** Each version has different rate limits (v1:100, v2:50, v3:80 requests/minute)

**Solution:** 
- Sliding window tracking using request timestamps
- Automatic delay calculation when approaching limits
- Exponential backoff with random jitter for retries

```javascript
async waitForRateLimit() {
  // Maintain 60-second sliding window
  const now = Date.now();
  this.requests = this.requests.filter(t => now - t <= 60000);
  while (this.requests.length >= this.rateLimit) {
    const oldest = this.requests[0];
    const waitTime = 60000 - (now - oldest) + 1;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    // Update window after waiting
    this.requests = this.requests.filter(t => Date.now() - t <= 60000);
  }
}
```

### 2. Query Optimization

**Problem:** Naive brute-force would require ~3.5×10¹⁸ requests for v3

**Solution:**
- Adaptive threshold system (stop expanding at 10/12/15 results)
- Character set restrictions per version
-  prefix expansion

```javascript
async explorePrefix(prefix) {
  const results = await this.queryAutocomplete(prefix);
  
  if (results.length >= this.threshold) {
    for (const char of this.getChars()) {
      // Prevent consecutive spaces in v3
      if (this.version === 'v3' && prefix.includes(' ') && char === ' ') continue;
      await this.explorePrefix(prefix + char);
    }
  }
}
```

### 3. Special Character Handling

**Problem:** v3 accepts special characters but with restrictions

**Solution:**
- Custom character set for each version
- Space character handling in v3
- Deduplication using Set()

```javascript
getChars() {
  switch(this.version) {
    case 'v1': return 'abcdefghijklmnopqrstuvwxyz';
    case 'v2': return 'abcdefghijklmnopqrstuvwxyz0123456789';
    case 'v3': return 'abcdefghijklmnopqrstuvwxyz0123456789 +-._';
  }
}
```

## Performance Metrics

### Final Results

| Version | Requests Made | Names Found |
|---------|--------------|-------------|
| v1      |   30,192     |  18,219     |
| v2      |    3,113     |   7,359     | 
| v3      |    7,076     |  12,489    |

**:red_circle: Note:IP address used : 35.207.196.198


## Usage

### Install dependencies:

```bash
npm install axios
```

### Run extraction:

```bash
node server.js
```

### Results saved as:
- `v1_names.json`
- `v2_names.json`
- `v3_names.json`
- `answers.json` (summary)



## Development & Discovery Process

### Problem Statement

**Task:** Extract all names available through an undocumented autocomplete API.

**Constraints:**
- No official documentation
- API rate limits and result thresholds had to be discovered through testing
- The API's behavior had to be reverse engineered by exploring various query combinations

### Key Discoveries

#### Rate Limits:
- **v1:** 100 requests per minute
- **v2:** 50 requests per minute
- **v3:** 80 requests per minute

#### Result Thresholds:
- **v1:** Threshold of 10 results
- **v2:** Threshold of 12 results
- **v3:** Threshold of 15 results

#### Character Sets:
- **v1 & v3:** Accept numbers; v3 additionally supports spaces and symbols
- **v2:** Accepts only alphabets

#### Ineffective Parameters
Attempts to increase the result count by adding parameters like `limit`, `size`, or `count` (e.g., `?query=a&limit=30`) were not successful.

### Challenges & Optimizations

#### Rate Limiting
Managing rate limits required:
- Tracking timestamps of requests
- Implementing a delay mechanism (`waitForRateLimit()`) to ensure the request count did not exceed the allowed limit

#### Recursive Search Complexity
- The recursive strategy to explore the query space based on thresholds increased the time complexity
- The threshold mechanism was crucial in reducing unnecessary requests by ensuring deeper exploration only when a query returned a high number of results

#### Handling Diverse Input Patterns
- Adjusting the character set based on API version was essential for accurate exploration
- Handling spaces and special symbols (especially in v3) added another layer of complexity


## Future Improvements

- Parallel request execution within rate limits
- Adaptive threshold learning based on historical responses
- Session persistence for better rate limit tracking
