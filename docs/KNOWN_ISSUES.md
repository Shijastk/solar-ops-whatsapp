# Known Issues and Open Concerns

## K001 - Custom deployment not yet tested end-to-end

The repository has initial implementation, but the deployed custom Vercel webhook has not yet been connected to Meta and proven against Supabase.

Do not call Milestone 1 complete.

## K002 - Vercel deployment is not yet established for this repository

The GitHub repository exists, but this repository was not found as an existing Vercel project during the initial connector inspection.

A deployment/import still needs to be established.

## K003 - Supabase runtime configuration not yet verified

The repository expects a Supabase project, SQL schema, private bucket, and environment secrets.

The code must not be described as operational until these are configured and tested.

## K004 - Meta access token lifecycle

The current Meta test setup may use a temporary token.

Before long-lived operation, token lifecycle and the appropriate production credential setup must be intentionally configured.

## K005 - Meta Graph API version must be verified

The source currently has a default Graph API version.

Do not assume that default is the correct production version merely because it is present in code.

Before production:

1. verify the current supported Meta Graph API version from official Meta documentation
2. intentionally pin the chosen version
3. update code/docs together

## K006 - No automated test suite yet

The project currently documents manual test cases but does not yet contain unit/integration test files.

## K007 - Webhook acknowledgement behavior

The current implementation processes media before returning the POST response.

For low-volume prototype testing this may be acceptable, but for production reliability Meta retry/timeout behavior should be reviewed. A future architecture may need fast acknowledgement plus durable background processing.

Do not change this architecture without user approval because it introduces queue/runtime choices.

## K008 - Media limits

The current default maximum media size is 15 MiB.

This is a project safety choice, not a claimed Meta platform limit.

Change it only intentionally.

## K009 - No OCR or inventory semantics

There is no defined rule yet for:

- which invoice fields matter
- how company identity is determined
- what constitutes stock in/out
- how corrections work
- who approves extracted data

These decisions must be defined with the user before adding OCR/inventory automation.
