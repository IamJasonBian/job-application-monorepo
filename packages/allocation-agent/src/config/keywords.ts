/**
 * Keywords used to auto-tag jobs as "quant-relevant".
 * Matched case-insensitively against job title + department.
 */
export const QUANT_KEYWORDS: string[] = [
  "quant", "quantitative", "trading", "risk", "alpha", "signal",
  "portfolio", "derivatives", "options", "futures", "hft",
  "low latency", "market making", "execution", "pricing",
  "stochastic", "statistical", "backtesting", "factor",
  "systematic", "algo", "algorithmic", "research",
  "machine learning", "data scientist", "data science",
  "c++", "rust", "fpga", "python", "kdb", "q language",
];
