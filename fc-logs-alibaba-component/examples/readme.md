````
$ s logs -s 1611823690000 -e 1611827290000 -r ab35f35a-4876-42a9-8924-18372abaff1d

# 由于底层库的原因，utc 格式解析不出来，暂不支持
$ s logs -s "Thu Jan 28 2021 16:48:10 GMT+0800" -e "Thu Jan 28 2021 17:48:10 GMT+0800" -r ab35f35a-4876-42a9-8924-18372abaff1d

$ s logs -t
````
