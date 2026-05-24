# Use Plain TypeScript Lambda Handlers

Backend API code will be written as plain TypeScript Lambda handlers with shared service modules where useful, rather than using Express or NestJS. The Personal Album has a thin API surface, and direct handlers keep the serverless deployment smaller and clearer without introducing a web server abstraction that the runtime does not need.
