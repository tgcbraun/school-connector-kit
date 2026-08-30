# Contributing

Contributions are welcome, particularly connectors for additional school
platforms used by schools in Germany.

## Important privacy rule

Never submit real school data, credentials, session tokens, cookies, pupil
information, or production database contents.

All public test fixtures must use synthetic data.

## Connector contributions

A connector should:

1. implement the public connector contract;
2. isolate platform-specific behaviour from the core package;
3. include automated tests;
4. use synthetic fixtures;
5. pass the shared connector contract tests;
6. document required configuration;
7. avoid exposing authentication secrets in logs or exceptions.

German school-domain terminology such as `Klassenarbeit`, `Hausaufgabe`,
`Vertretungsplan`, or `Elternbrief` may be retained where translating the
concept would reduce precision.

More detailed connector-authoring documentation will be added as the public
contract stabilizes.
