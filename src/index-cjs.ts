import requestImpl from "#/index";
import type * as PublicTypes from "#/types/public";

const request: typeof requestImpl = requestImpl;

// Resolve imported types outside the namespace to avoid shadowing in bundles.
type PublicApi = {
  BufferEncoding: PublicTypes.BufferEncoding;
  CacheCanCacheFunction: PublicTypes.CacheCanCacheFunction;
  CachedResponse: PublicTypes.CachedResponse;
  CacheIsExpiredFunction: PublicTypes.CacheIsExpiredFunction;
  CacheIsMatchFunction: PublicTypes.CacheIsMatchFunction;
  CachePolicyResponse: PublicTypes.CachePolicyResponse;
  FormDataEntry: PublicTypes.FormDataEntry;
  GetBody: PublicTypes.GetBody;
  GetJSON: PublicTypes.GetJSON;
  Headers: PublicTypes.Headers;
  HttpAuthOptions: PublicTypes.HttpAuthOptions;
  HttpAuthType: PublicTypes.HttpAuthType;
  HttpVerb: PublicTypes.HttpVerb;
  HttpVersion: PublicTypes.HttpVersion;
  IpFamily: PublicTypes.IpFamily;
  JsonLike: PublicTypes.JsonLike;
  JsonPrimitive: PublicTypes.JsonPrimitive;
  NestedJsonLike: PublicTypes.NestedJsonLike;
  Options: PublicTypes.Options;
  ProxyAuthType: PublicTypes.ProxyAuthType;
  ProxyOptions: PublicTypes.ProxyOptions;
  RequestErrorCode: PublicTypes.RequestErrorCode;
  Response: PublicTypes.Response;
  RetryDelayFunction: PublicTypes.RetryDelayFunction;
  RetryFunction: PublicTypes.RetryFunction;
  RetryResponse: PublicTypes.RetryResponse;
  TlsCertificateType: PublicTypes.TlsCertificateType;
  TlsOptions: PublicTypes.TlsOptions;
  TlsVersion: PublicTypes.TlsVersion;
};

// A type-only namespace lets the callable CommonJS export expose named types.
declare namespace request {
  type FormData = InstanceType<typeof request.FormData>;
  type CurlError = InstanceType<typeof request.CurlError>;
  type RequestError = InstanceType<typeof request.RequestError>;
  type ResponseError = InstanceType<typeof request.ResponseError>;

  type BufferEncoding = PublicApi["BufferEncoding"];
  type CacheCanCacheFunction = PublicApi["CacheCanCacheFunction"];
  type CachedResponse = PublicApi["CachedResponse"];
  type CacheIsExpiredFunction = PublicApi["CacheIsExpiredFunction"];
  type CacheIsMatchFunction = PublicApi["CacheIsMatchFunction"];
  type CachePolicyResponse = PublicApi["CachePolicyResponse"];
  type FormDataEntry = PublicApi["FormDataEntry"];
  type GetBody = PublicApi["GetBody"];
  type GetJSON = PublicApi["GetJSON"];
  type Headers = PublicApi["Headers"];
  type HttpAuthOptions = PublicApi["HttpAuthOptions"];
  type HttpAuthType = PublicApi["HttpAuthType"];
  type HttpVerb = PublicApi["HttpVerb"];
  type HttpVersion = PublicApi["HttpVersion"];
  type IpFamily = PublicApi["IpFamily"];
  type JsonLike = PublicApi["JsonLike"];
  type JsonPrimitive = PublicApi["JsonPrimitive"];
  type NestedJsonLike = PublicApi["NestedJsonLike"];
  type Options = PublicApi["Options"];
  type ProxyAuthType = PublicApi["ProxyAuthType"];
  type ProxyOptions = PublicApi["ProxyOptions"];
  type RequestErrorCode = PublicApi["RequestErrorCode"];
  type Response = PublicApi["Response"];
  type RetryDelayFunction = PublicApi["RetryDelayFunction"];
  type RetryFunction = PublicApi["RetryFunction"];
  type RetryResponse = PublicApi["RetryResponse"];
  type TlsCertificateType = PublicApi["TlsCertificateType"];
  type TlsOptions = PublicApi["TlsOptions"];
  type TlsVersion = PublicApi["TlsVersion"];
}

export default request;
