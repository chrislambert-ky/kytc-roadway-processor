import json
import requests
import pandas as pd
from shapely import wkt
from furl import furl
from time import perf_counter

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
number_of_rows = 20  # value between 1-1000

# create a list to store the results in
results = list()

# ----------------------------------------------------------------------------------------------------------------------
# Functions
# ----------------------------------------------------------------------------------------------------------------------


def snap_points(row):

    pt = wkt.loads(row['GEOMETRY'])

    # Build the request url with parameters
    url = furl(path=rf"{url_base}route/GetRouteInfoByCoordinates",
               query_params={
                   "xcoord": f"{pt.x}",
                   "ycoord": f"{pt.y}",
                   "snap_distance": 200,
                   "request_id": row['Request_Id']
               })

    res = requests.get(url.tostr())

    if res.status_code == 200:
        res = json.loads(res.content.decode('utf-8'))
        if 'Route_Info' in res:
            res['Route_Info']['Request_Id'] = res['Request_Id']
            results.append(res['Route_Info'])
        elif 'Info' in res:
            print(res['Info'], res['Request_Id'])
    else:
        print(res)

# ----------------------------------------------------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------------------------------------------------


if __name__ == '__main__':

    # Read the speed data into a pandas dataframe
    df = pd.read_csv(csv_file, nrows=number_of_rows)

    # Create a Request Id
    df['Request_Id'] = df.index.astype(str)

    # Start the stopwatch / counter
    perf_counter_start = perf_counter()

    # Snap the points by sending requests to the API
    df.apply(snap_points, axis=1)

    # Stop the stopwatch / counter
    perf_counter_stop = perf_counter()

    # Put the results into a pandas dataframe
    df_results = pd.DataFrame(results)

    # Rename the original input geometry
    df.rename(columns={'GEOMETRY': 'ORIGINAL_GEOMETRY'})

    # Merge/join the original data to the snapped results
    df = df.merge(df_results, on='Request_Id', how='left')

    print(df.head(len(results)))

    print(f"\nTime to snap {number_of_rows} points (synchronously): {perf_counter_stop - perf_counter_start}")
