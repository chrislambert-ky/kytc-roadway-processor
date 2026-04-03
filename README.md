# kytc-roadway-processor
Provides a user-friendly front-end to the Kentucky Transportation Cabinet spatial API.  The API will accept GPS coordinates and return linear referencing system (LRS attributes such as County, Route, Mile Point, etc.

### Guidelines:
- Use eda-project-styling-guide.html for styling hints
- Use simple HTML, CSS, Javascript.
- Error on the side of simplicity with minimal amount of html, js, and css files.
    - Ideally, just 1 html, 1 css, and 1 javascript file would be needed.
- Give preferential treatment to duckdb-wasm as part of the architecture but be open to using other, similar, libraries.

### Idea
- I need for you to research this API and develop a plan to create a better front-end for it.
- I'm really into duckdb-wasm at the moment so I thought about something where a user can import locally stored (or hosted) data into a table (from CSV, JSON, Parquet, GeoJSON -- anything that duckdb-wasm can handle, or URL with no CORS limitations), and then interact with the data a little, click on a list of roadway attributes, and then watch as the API fetches the attributes and adds them into the table.  Then, the user would have a selection of compatible files to download.  So anything duckdb-wasm compatible in addition to kml or kmz.
- App will be hosted as single page webapge using github pages.
- This API is used and made available by the Kentucky Transportation Cabinet to provide the latest roadway attributes.
- https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs
- https://kytc-api-v100-docs-qrntk7e3ra-uc.a.run.app/app
- List of attributes can be found inside kytc_route_api_keys.csv


