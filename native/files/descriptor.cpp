#ifdef _WIN32
#define NAPI_EXTERN extern
#include <windows.h>
#include <io.h>
#endif
#define NAPI_VERSION 8
#include <node_api.h>
#include <cstdint>
#include <string>
#ifndef _WIN32
#include <fcntl.h>
#include <sys/param.h>
#include <sys/attr.h>
#include <sys/stat.h>
#include <unistd.h>
#include <uuid/uuid.h>
#endif
#ifdef _WIN32
// Resolve Node-API from the host. This works in both node.exe and Electron's
// renamed embedded Node runtime without depending on a node.exe import DLL.
template<typename T> T hostApi(const char* name) { return reinterpret_cast<T>(GetProcAddress(GetModuleHandleW(nullptr), name)); }
#define API(name) hostApi<decltype(&name)>(#name)
#else
#define API(name) name
#endif
static napi_value descriptorPath(napi_env env, napi_callback_info info) {
  size_t argc=1;napi_value arg;int32_t fd;
  if(API(napi_get_cb_info)(env,info,&argc,&arg,nullptr,nullptr)!=napi_ok||argc!=1||API(napi_get_value_int32)(env,arg,&fd)!=napi_ok||fd<0){API(napi_throw_error)(env,nullptr,"Invalid open descriptor.");return nullptr;}
  napi_value result;
#ifdef _WIN32
  intptr_t handle=_get_osfhandle(fd);
  if(handle==-1){API(napi_throw_error)(env,nullptr,"Cannot resolve the open file handle.");return nullptr;}
  wchar_t path[32768];DWORD size=GetFinalPathNameByHandleW(reinterpret_cast<HANDLE>(handle),path,32768,FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
  if(size==0||size>=32768){API(napi_throw_error)(env,nullptr,"Cannot resolve the open file path.");return nullptr;}
  std::wstring normalized(path,size);
  if(normalized.rfind(L"\\\\?\\UNC\\",0)==0)normalized=L"\\\\"+normalized.substr(8);
  else if(normalized.rfind(L"\\\\?\\",0)==0)normalized=normalized.substr(4);
  API(napi_create_string_utf16)(env,reinterpret_cast<const char16_t*>(normalized.data()),normalized.size(),&result);
#else
  char path[MAXPATHLEN];
  if(fcntl(fd,F_GETPATH,path)==-1){API(napi_throw_error)(env,nullptr,"Cannot resolve the open file path.");return nullptr;}
  API(napi_create_string_utf8)(env,path,NAPI_AUTO_LENGTH,&result);
#endif
  return result;
}
#ifndef _WIN32
// Bind to the opened directory and its persistent volume UUID. st_dev is a
// mount-time number on macOS and may change after a reboot.
static napi_value workspaceIdentity(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value arg; int32_t fd;
  if (napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr) != napi_ok || argc != 1 ||
      napi_get_value_int32(env, arg, &fd) != napi_ok || fd < 0) {
    napi_throw_error(env, nullptr, "Invalid workspace descriptor."); return nullptr;
  }
  struct stat statbuf{};
  struct attrlist attrs{};
  attrs.bitmapcount = ATTR_BIT_MAP_COUNT;
  attrs.commonattr = ATTR_CMN_RETURNED_ATTRS;
  attrs.volattr = ATTR_VOL_INFO | ATTR_VOL_UUID;
  struct __attribute__((packed, aligned(4))) {
    uint32_t length;
    attribute_set_t returned;
    uuid_t uuid;
  } volume{};
  if (fstat(fd, &statbuf) != 0 || !S_ISDIR(statbuf.st_mode) ||
      fgetattrlist(fd, &attrs, &volume, sizeof(volume), 0) != 0 ||
      volume.length != sizeof(volume) || !(volume.returned.volattr & ATTR_VOL_UUID) ||
      uuid_is_null(volume.uuid)) {
    napi_throw_error(env, nullptr, "Cannot verify the workspace volume identity."); return nullptr;
  }
  char uuid[37]; uuid_unparse_lower(volume.uuid, uuid);
  std::string identity = std::string("mac-v2:") + uuid + ":" +
    std::to_string(statbuf.st_ino) + ":" + std::to_string(statbuf.st_birthtimespec.tv_sec) +
    ":" + std::to_string(statbuf.st_birthtimespec.tv_nsec);
  napi_value result;
  napi_create_string_utf8(env, identity.c_str(), identity.size(), &result);
  return result;
}
#endif
static napi_value init(napi_env env,napi_value exports){
#ifdef _WIN32
  if(!API(napi_create_function)||!API(napi_set_named_property)||!API(napi_get_cb_info)||!API(napi_get_value_int32)||!API(napi_throw_error)||!API(napi_create_string_utf16))return nullptr;
#endif
  napi_value fn;API(napi_create_function)(env,"descriptorPath",NAPI_AUTO_LENGTH,descriptorPath,nullptr,&fn);API(napi_set_named_property)(env,exports,"descriptorPath",fn);
#ifndef _WIN32
  napi_create_function(env,"workspaceIdentity",NAPI_AUTO_LENGTH,workspaceIdentity,nullptr,&fn);
  napi_set_named_property(env,exports,"workspaceIdentity",fn);
#endif
  return exports;
}
NAPI_MODULE(studio_files,init)
