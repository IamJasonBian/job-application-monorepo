/**
 * CANDIDATE PROFILE
 *
 * Resume data structured for auto-applications.
 * Edit this file with your own information.
 */

export interface CandidateProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedIn: string;
  github: string;
  location: string;
  legalName: string;
  authorizedToWork: boolean;
  requiresSponsorship: boolean;
  veteranStatus: boolean;
  resumeText: string;
  /** Keywords to match against job titles */
  targetRoles: string[];
  /** Preferred locations (lowercase) */
  targetLocations: string[];
  /** Skills for matching */
  skills: string[];
}

export const candidate: CandidateProfile = {
  firstName: "Jason",
  lastName: "Bian",
  email: "jason.bian64@gmail.com",
  phone: "+1-734-730-6569",
  linkedIn: "https://linkedin.com/in/jasonzb",
  github: "https://github.com/jasonzb",
  location: "New York, NY",
  legalName: "Jason Bian",
  authorizedToWork: true,
  requiresSponsorship: false,
  veteranStatus: false,
  targetRoles: [
    "data engineer",
    "software engineer",
    "backend engineer",
    "machine learning engineer",
    "platform engineer",
    "python engineer",
    "data scientist",
    "quantitative",
  ],
  targetLocations: [
    "new york",
    "nyc",
    "ny",
    "remote",
    "united states",
  ],
  skills: [
    "python", "java", "sql", "spark", "scala", "typescript", "c++",
    "airflow", "pytorch", "django", "flask", "numpy", "pandas", "aws-cdk",
    "redshift", "postgres", "react", "javascript",
    "databricks", "delta lake", "cloudformation", "sagemaker", "glue",
    "kafka", "redis", "docker", "kubernetes",
    "machine learning", "deep learning", "forecasting",
    "data pipeline", "etl", "ci/cd",
  ],
  resumeText: `JASON BIAN
New York, New York 10018 | +1 734-730-6569 | jason.bian64@gmail.com | linkedin.com/in/jasonzb | GitHub

PROFESSIONAL EXPERIENCE

AMAZON.COM — Data Engineer II (2021 – Present)
Retail Technology
• High Cardinality Forecast Generation in Java, Python and Spark
• RL-based development for inventory purchasing actions, supported inference for RL agent pipelines and launched buying actions on 5% of US retail
• Reduced latency of ~550 different input signals, shortening end-to-end pipeline runtime of 4 deep learning forecasting models to 6.4x
• Sev2 real-time support for interns, batch, and consortium executions of 4 core deep learning forecasting models with 1120 weekly runs across all jql, merchandise, asin, and marketplace level hierarchies within amazon retail
• Defined requirements, support patterns, customer acquisition and long term needs with 20+ software and data science partner teams
• Package development, refactoring, and migrations for forecast vending/destination spin in java and Python
• Reduced data ingestion pipeline and forecasting audits from 48 hours to 5 hours
• Maintained a yearly merged DS (Full-Refresh) count of ~185 across 24 packages with 2.3 mag revisions

Worldwide Sustainability
• Seller Burn for Emissions Experimentation, Optimization, and A/B Testing
• Supported supply chain transfer decisions targeting ~1.5% of US total emissions via the green shipping initiative on amazon.com/lower carbon
• ~$4K above average $19/hour sustained quarterly abatement in 2023 via emission efficient routing

Retail Emissions Data Lake
• Designed python and scala applications to support data ingestion from external vendors and externalization of carbon data at ship with amazon scale
• Carbon consulting support for internal teams on tradeoffs between speed, cost, and carbon with internal customer growth of 27 to 55 teams
• Managed the core time-changing dimension tables for package level carbon
• Increased high specificity fuel tracking carbon data availability for warehouse transfer events from 63% to 77%
• Increased total pipeline test coverage from 33% to 90% for inbound and warehouse transfer
• Extended alpha/beta environments, CI/CD, logging, integration testing and orchestration mechanisms to reduce ops load covering a daily row count of ~15.3 billion read/writes

AMAZON.COM — Business Intelligence Engineer II (2021 – 2022)
AMZL CSET
• Generation of Weekly Delivery Associate Hiring Targets
• Upstream load pipeline maintenance for weekly hiring target LP (Linear Programming) solves, resulting in a 10% forecast error reduction across all 500+ DS (Delivery stations) in amazon retail
• Parameter tuning and auditing support for core delivery associate attrition, pipeline packages, and supply vs capacity commitment models at DS level
• Automated scenario analysis by injecting python heuristics into capacity optimization systems, reducing ~450 hours of lab per month and reduced publishing cycles from weekly to hourly

MICROSOFT — Program Manager (2020 – 2021)
Azure Decision Science
• Developed end-to-end capacity management programs with sprint planning, ops review, and weekly shiproom metrics
• Directly managed buying inputs into ~$5 million dollars of monthly infrastructure capex
• Scaled offer restriction planning and automated quota management from 30% to 65% of all azure services via sprint planning, automation, and operational improvements
• Built CVP level analytics infrastructure for growth and week of supply in monthly capacity reviews

OPTIMASON — Founder (2022 – Present)
• Consulting shop focused on azure cloud migrations, pre-sale proof-of-concepts, data estate development, and self-service replatform initiatives
• Built and sold deployable azure and databricks templates
• Acquired $4K of YTD revenue from consulting engagements nationwide during 0-to-1 growth phase
• Migrated aging manual systems with 1800+ hours of man-hours saved across all projects
• Development of custom migration frameworks for local-to-cloud workloads using Microsoft sponsored design patterns

TECH SKILLS
Programming: Java, Python (airflow, gluonts, pytorch, django, flask, numpy, pandas, aws-cdk), R, SQL, Spark, Redshift, Postgres, C++, JavaScript (React), C, Scala, TypeScript, Unix Shell, Lisp (Clojure)
Frameworks: Apache (parser, presto, beam, flink), Azure (databricks, datafactory, eventhub), AWS (glue, sagemaker, emr, lambda, redshift, sns, cloudwatch, cdk), CloudFormation, Databricks (Delta Lake), GitHub Actions, Jenkins
Stats/Optimization: ARIMA, PCA, Convex Optimization, Regression/Random Forest, Linear Programming, Markov Chains, Simulation

EDUCATION
B.S.E Industrial and Operations Engineering, University of Michigan Ann Arbor — Major GPA 3.83 (Dec 2019)`,
};
