cmake_minimum_required(VERSION 3.18)
project(sync_request_curl_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CURL_USE_STATIC_LIBS ON)

find_package(CURL REQUIRED)

add_library(sync_request_curl_native SHARED addon.cc)
target_include_directories(
  sync_request_curl_native
  PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/node-api"
)
target_link_libraries(sync_request_curl_native PRIVATE CURL::libcurl)

if(APPLE)
  target_link_options(sync_request_curl_native PRIVATE "-undefined" "dynamic_lookup")
elseif(WIN32)
  if(NOT NODE_IMPORT_LIB)
    message(FATAL_ERROR "NODE_IMPORT_LIB must point to node.lib on Windows")
  endif()
  target_link_libraries(sync_request_curl_native PRIVATE "${NODE_IMPORT_LIB}")
endif()

if(UNIX AND NOT APPLE)
  target_link_options(
    sync_request_curl_native
    PRIVATE
    -static-libgcc
    -static-libstdc++
  )
endif()

target_compile_definitions(
  sync_request_curl_native
  PRIVATE
  NAPI_VERSION=8
  BUILDING_NODE_EXTENSION
)
set_target_properties(
  sync_request_curl_native
  PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
)

if(MSVC)
  target_compile_options(sync_request_curl_native PRIVATE /W4 /EHsc)
else()
  target_compile_options(sync_request_curl_native PRIVATE -Wall -Wextra -Wpedantic)
endif()
