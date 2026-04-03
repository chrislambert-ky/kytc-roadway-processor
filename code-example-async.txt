import asyncio
import aiohttp  # 3.8.4
import json
from furl import furl
import pandas as pd
from shapely import wkt
from time import perf_counter
asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ----------------------------------------------------------------------------------------------------------------------
# Pandas Options
# ----------------------------------------------------------------------------------------------------------------------

# set to show the max width of the dataframe when printing
pd.set_option('display.width', None)
pd.set_option('display.max_columns', None)
pd.set_option('display.max_colwidth', None)
pd.set_option('display.max_rows', None)

# ----------------------------------------------------------------------------------------------------------------------
# Variables
# ----------------------------------------------------------------------------------------------------------------------

url_base = r"https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/"
csv_file = r"https://kytc-api-v100-docs-qrntk7e3ra-uc.a.run.app/data/data_point_sample.csv"
number_of_rows = 1000  # value between 1-1000
return_keys = r"District_Number, County_Name, Route_Unique_Identifier, Milepoint, " \
              r"Route, Road_Name, Bridge_Identifier, Geometry"

# sets the number of connections allowed to the requesting servers (containers in this case)
# when going over the default (100) it may lead to spinning up additional containers
aiohttp_connector_limit = 100
semaphore_counter = 100

# exception handling lists
exception_errors = list()  # a list for failed responses due to exceptions (need to be reprocessed)
response_errors = list()  # a list for failed responses due to other reasons (such as snapping or road network issues)
exception_retries = list()  # a list for storing the urls that need to be reprocessed
results_all = list()  # a list to store the results in

timeout_sec = 10  # set the timeout in seconds for the request
requests_completed = 0  # keep count of the number of requests completed
requests_complete_log_size = 200  # print/log request completion in this chunk size (ex. 1/10th of total record count)


# ----------------------------------------------------------------------------------------------------------------------
# Functions
# ----------------------------------------------------------------------------------------------------------------------

def generate_urls(row):

    pt = wkt.loads(row['GEOMETRY'])

    # Build the request url with parameters
    url = furl(path=rf"{url_base}route/GetRouteInfoByCoordinates",
               query_params={
                   "xcoord": f"{pt.x}",
                   "ycoord": f"{pt.y}",
                   "snap_distance": 200,
                   "return_keys": return_keys,
                   "request_id": row['Request_Id']
               })

    return url.tostr()


async def get_data(session, sem, url):
    global requests_completed
    try:
        # start = time.time()
        perf_start = perf_counter()
        # async with session.get(url) as response:
        async with sem, session.get(url) as response:
            resp = await response.text()
            requests_completed += 1
            if requests_completed % requests_complete_log_size == 0:
                perf_stop = perf_counter()
                print(f"Processed records: {str(requests_completed).rjust(7, ' ')} | "
                      f"Time elapsed (seconds): {round(perf_stop - perf_start, 3)}")

            if response.status == 200:
                if 'Route_Info' in resp:
                    res = json.loads(resp)
                    res['Route_Info']['Request_Id'] = res['Request_Id']  # put the request id as part of the record
                    return res['Route_Info']
                elif 'Info' in resp:
                    response_errors.append({"Error Status": response.status, "URL": url, "Message": resp})
                    return {}
            elif response.status in [500, 503]:
                exception_retries.append(url)
                exception_errors.append({resp: url})
                return {}
            else:
                response_errors.append({"Error Status": response.status, "URL": url, "Message": resp})
                return {}
    except (asyncio.TimeoutError, aiohttp.ClientConnectionError, aiohttp.ClientError) as e:
        exception_retries.append(url)
        exception_errors.append({str(e): url})
        return {}


async def get_all(session, sem, urls):
    tasks = [asyncio.create_task(get_data(session, sem, url)) for url in urls]
    return await asyncio.gather(*tasks, return_exceptions=True)


async def main(urls):
    connector = aiohttp.TCPConnector(limit=aiohttp_connector_limit)
    sem = asyncio.Semaphore(semaphore_counter)
    async with aiohttp.ClientSession(connector=connector) as session:
        return await get_all(session, sem, urls)

# ----------------------------------------------------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------------------------------------------------


if __name__ == '__main__':

    # Read the speed data into a pandas dataframe
    df = pd.read_csv(csv_file, nrows=number_of_rows)

    # Create a Request Id
    df['Request_Id'] = df.index.astype(str)

    # Create a list of urls to request from the API
    print('-' * 100)
    print("Generating request urls for sending to the API...")
    print('-' * 100)
    df['URLS'] = df.apply(generate_urls, axis=1)
    url_list = df['URLS'].tolist()

    # Start the stopwatch / counter
    perf_counter_start = perf_counter()

    while True:
        results = asyncio.run(main(url_list))
        results_all.extend(results)
        if not exception_retries:
            print('=' * 100)
            print("Finished snapping all records...")
            print(f"Number of response errors received: {len(response_errors)}")
            print('=' * 100)
            break
        else:
            print('-' * 100)
            print(f"Number of exception errors received: {len(exception_errors)}")
            print("Reprocessing exception errors...")
            url_list = exception_retries.copy()
            exception_retries.clear()

    perf_counter_stop = perf_counter()

    df_results = pd.DataFrame(results_all)

    # Rename the original input geometry
    df.rename(columns={'GEOMETRY': 'ORIGINAL_GEOMETRY'})

    # Merge/join the original data to the snapped results
    df = df.merge(df_results, on='Request_Id', how='left')
    df.drop(columns='URLS', inplace=True)

    print(df.head())

    print(f"\nTime to snap {number_of_rows} points (asynchronously): {perf_counter_stop - perf_counter_start}")