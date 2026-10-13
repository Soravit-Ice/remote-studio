// Remote Studio native LPAC launcher. The agent owns argv and environment.
// No renderer IPC, network listener, credentials, or unsandboxed fallback.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <userenv.h>
#include <sddl.h>
#include <aclapi.h>
#include <string>
#include <vector>
#include <stdexcept>
#include <iostream>
#include <filesystem>
#include <cwctype>
#include <io.h>
#include <cstdint>
#pragma comment(lib, "userenv.lib")
#pragma comment(lib, "advapi32.lib")

static void check(bool ok, const char* message) {
  if (!ok) throw std::runtime_error(std::string(message) + " (Win32 " + std::to_string(GetLastError()) + ")");
}
static std::wstring quote(const std::wstring& s) {
  std::wstring out = L"\""; size_t slashes = 0;
  for (auto c : s) {
    if (c == L'\\') { ++slashes; continue; }
    if (c == L'"') { out.append(slashes * 2 + 1, L'\\'); out += c; }
    else { out.append(slashes, L'\\'); out += c; }
    slashes = 0;
  }
  out.append(slashes * 2, L'\\'); return out + L"\"";
}
static std::wstring canonical(const std::wstring& path) {
  HANDLE h = CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  check(h != INVALID_HANDLE_VALUE, "Cannot open sandbox root");
  FILE_ATTRIBUTE_TAG_INFO info{};
  bool ok = GetFileInformationByHandleEx(h, FileAttributeTagInfo, &info, sizeof(info));
  if (!ok || (info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) { CloseHandle(h); throw std::runtime_error("Sandbox roots cannot be reparse points"); }
  std::vector<wchar_t> buf(32768);
  DWORD n = GetFinalPathNameByHandleW(h, buf.data(), static_cast<DWORD>(buf.size()), FILE_NAME_NORMALIZED);
  CloseHandle(h); check(n && n < buf.size(), "Cannot canonicalize root");
  std::wstring result(buf.data(), n);
  if (result.rfind(L"\\\\?\\", 0) == 0) result.erase(0, 4);
  return result;
}
// Add only a unique per-launch SID; remove only that SID, preserving every
// unrelated ACE (including ACL edits made by the owner while a job runs).
static void acl(const std::wstring& path, PSID sid, bool write, bool remove) {
  PACL old = nullptr, next = nullptr; PSECURITY_DESCRIPTOR sd = nullptr;
  DWORD error = GetNamedSecurityInfoW(path.c_str(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, &old, nullptr, &sd);
  check(error == ERROR_SUCCESS, "Read ACL failed");
  if (remove) {
    DWORD size = old ? old->AclSize : sizeof(ACL);
    next = static_cast<PACL>(LocalAlloc(LPTR, size));
    check(next && InitializeAcl(next, size, ACL_REVISION), "Allocate ACL failed");
    for (DWORD i = 0; old && i < old->AceCount; ++i) {
      void* ace = nullptr; check(GetAce(old, i, &ace), "Read ACE failed");
      auto header = static_cast<ACE_HEADER*>(ace);
      bool own = header->AceType == ACCESS_ALLOWED_ACE_TYPE && EqualSid(sid, &static_cast<ACCESS_ALLOWED_ACE*>(ace)->SidStart);
      if (!own) check(AddAce(next, ACL_REVISION, MAXDWORD, ace, header->AceSize), "Copy ACE failed");
    }
  } else {
    EXPLICIT_ACCESSW entries[2]{};
    for (auto& e : entries) {
      e.grfAccessMode = GRANT_ACCESS; e.Trustee.TrusteeForm = TRUSTEE_IS_SID;
      e.Trustee.TrusteeType = TRUSTEE_IS_UNKNOWN; e.Trustee.ptstrName = static_cast<LPWSTR>(sid);
    }
    // Root itself has no DELETE / WRITE_DAC / WRITE_OWNER permission.
    entries[0].grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE | (write ? FILE_GENERIC_WRITE : 0);
    entries[1].grfAccessPermissions = entries[0].grfAccessPermissions | (write ? DELETE | FILE_DELETE_CHILD : 0);
    entries[1].grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT | INHERIT_ONLY;
    error = SetEntriesInAclW(2, entries, old, &next);
    if (error != ERROR_SUCCESS) { LocalFree(sd); throw std::runtime_error("Grant ACL failed"); }
  }
  error = SetNamedSecurityInfoW(const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, next, nullptr);
  LocalFree(next); LocalFree(sd);
  if (error != ERROR_SUCCESS) throw std::runtime_error("Sandbox ACL failed; run native setup with permission to grant the selected folder/runtime (" + std::to_string(error) + ")");
}
static bool loopback(const std::wstring& sid, bool add) {
  wchar_t system[MAX_PATH]; GetSystemDirectoryW(system, MAX_PATH);
  std::wstring command = quote(std::wstring(system) + L"\\CheckNetIsolation.exe") + L" LoopbackExempt " + (add ? L"-a -p=" : L"-d -p=") + sid;
  STARTUPINFOW si{}; si.cb = sizeof(si); si.dwFlags = STARTF_USESTDHANDLES;
  HANDLE nul = CreateFileW(L"NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
  SetHandleInformation(nul, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
  si.hStdInput = si.hStdOutput = si.hStdError = nul;
  PROCESS_INFORMATION pi{}; bool ok = CreateProcessW(nullptr, command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
  DWORD code = 1;
  if (ok) { WaitForSingleObject(pi.hProcess, 10000); GetExitCodeProcess(pi.hProcess, &code); CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
  CloseHandle(nul); return ok && code == 0;
}
int wmain(int argc, wchar_t** argv) {
  std::wstring id, workspace, privateRoot; std::vector<std::wstring> reads, granted;
  bool cleanup = false, exempted = false; PSID sid = nullptr; HANDLE job = nullptr;
  std::wstring name, sidString;
  int split = argc, exitCode = 1;
  try {
    // A native query avoids PowerShell startup and returns an empty identity for
    // an exited process. Preserve the DateTime tick epoch used by old records.
    if (argc == 3 && std::wstring(argv[1]) == L"--process-identity") {
      std::wstring value = argv[2];
      check(!value.empty() && value.find_first_not_of(L"0123456789") == std::wstring::npos, "Invalid process ID");
      auto parsed = std::stoull(value);
      check(parsed > 1 && parsed <= MAXDWORD, "Invalid process ID");
      HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, static_cast<DWORD>(parsed));
      if (!process && GetLastError() == ERROR_INVALID_PARAMETER) return 0;
      check(process != nullptr, "Cannot inspect native process");
      if (WaitForSingleObject(process, 0) == WAIT_OBJECT_0) { CloseHandle(process); return 0; }
      FILETIME birth{}, exit{}, kernel{}, user{};
      bool ok = GetProcessTimes(process, &birth, &exit, &kernel, &user);
      CloseHandle(process); check(ok, "Cannot read native process birth");
      std::uint64_t ticks = (static_cast<std::uint64_t>(birth.dwHighDateTime) << 32) | birth.dwLowDateTime;
      std::cout << ticks + 504911232000000000ULL << std::endl;
      return 0;
    }
    // libuv passes fd 3 through MSVCRT. Only the trusted supervisor owns its
    // write end; LPAC children inherit the explicit stdin/stdout/stderr allowlist.
    if (argc > 1 && std::wstring(argv[1]) != L"--cleanup") {
      unsigned char release = 0;
      check(_read(3, &release, 1) == 1 && release == 1, "Native launch authorization pipe closed");
      _close(3);
    }
    for (int i = 1; i < argc; ++i) {
      std::wstring arg = argv[i];
      if (arg == L"--") { split = i + 1; break; }
      if (arg == L"--cleanup") { cleanup = true; continue; }
      check(i + 1 < argc, "Missing argument");
      std::wstring value = argv[++i];
      if (arg == L"--id") id = value;
      else if (arg == L"--workspace") workspace = canonical(value);
      else if (arg == L"--private") privateRoot = canonical(value);
      else if (arg == L"--read") reads.push_back(canonical(value));
      else throw std::runtime_error("Unknown native option");
    }
    check(id.size() == 36 && id.find_first_not_of(L"0123456789abcdef-") == std::wstring::npos && !workspace.empty(), "Invalid launch scope");
    name = L"RemoteStudio." + id;
    HRESULT hr = cleanup ? DeriveAppContainerSidFromAppContainerName(name.c_str(), &sid) : CreateAppContainerProfile(name.c_str(), name.c_str(), L"Scoped Remote Studio job", nullptr, 0, &sid);
    if (!cleanup && hr == HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)) hr = DeriveAppContainerSidFromAppContainerName(name.c_str(), &sid);
    check(SUCCEEDED(hr), "Create AppContainer profile failed");
    LPWSTR str = nullptr; check(ConvertSidToStringSidW(sid, &str), "SID conversion failed"); sidString = str; LocalFree(str);
    if (cleanup) {
      for (auto& r : reads) acl(r, sid, false, true);
      acl(workspace, sid, true, true); loopback(sidString, false); DeleteAppContainerProfile(name.c_str()); FreeSid(sid); return 0;
    }
    check(split < argc && !privateRoot.empty(), "Executable/private scope required");
    auto lower = [](std::wstring s) { for (auto& c : s) c = static_cast<wchar_t>(towlower(c)); return s; };
    auto w = lower(workspace) + L"\\", p = lower(privateRoot) + L"\\";
    if (w.rfind(p, 0) == 0 || p.rfind(w, 0) == 0) throw std::runtime_error("Workspace cannot contain application credentials");
    for (auto& r : reads) { acl(r, sid, false, false); granted.push_back(r); }
    acl(workspace, sid, true, false); granted.push_back(workspace);
    exempted = loopback(sidString, true);
    if (!exempted) throw std::runtime_error("LPAC loopback setup failed. Administrator permission is required for native Windows preview networking.");
    std::vector<std::vector<BYTE>> sidBytes(3, std::vector<BYTE>(SECURITY_MAX_SID_SIZE));
    WELL_KNOWN_SID_TYPE types[] = { WinCapabilityInternetClientSid, WinCapabilityInternetClientServerSid, WinCapabilityPrivateNetworkClientServerSid };
    SID_AND_ATTRIBUTES caps[3]{};
    for (int i = 0; i < 3; ++i) { DWORD n = SECURITY_MAX_SID_SIZE; check(CreateWellKnownSid(types[i], nullptr, sidBytes[i].data(), &n), "Network capability failed"); caps[i] = { sidBytes[i].data(), SE_GROUP_ENABLED }; }
    SECURITY_CAPABILITIES capabilities{sid, caps, 3, 0};
    SIZE_T bytes = 0; InitializeProcThreadAttributeList(nullptr, 3, 0, &bytes);
    auto attributes = static_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(HeapAlloc(GetProcessHeap(), 0, bytes));
    check(attributes && InitializeProcThreadAttributeList(attributes, 3, 0, &bytes), "Initialize LPAC attributes failed");
    check(UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, &capabilities, sizeof(capabilities), nullptr, nullptr), "LPAC capabilities failed");
    DWORD optOut = PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT;
    check(UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY, &optOut, sizeof(optOut), nullptr, nullptr), "LPAC opt-out failed");
    HANDLE handles[] = { GetStdHandle(STD_INPUT_HANDLE), GetStdHandle(STD_OUTPUT_HANDLE), GetStdHandle(STD_ERROR_HANDLE) };
    for (auto handle : handles) check(SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT), "Pipe inheritance failed");
    check(UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles, sizeof(handles), nullptr, nullptr), "Pipe allowlist failed");
    STARTUPINFOEXW si{}; si.StartupInfo.cb = sizeof(si); si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = handles[0]; si.StartupInfo.hStdOutput = handles[1]; si.StartupInfo.hStdError = handles[2]; si.lpAttributeList = attributes;
    job = CreateJobObjectW(nullptr, nullptr); check(job != nullptr, "Create Job Object failed");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits)), "Job kill-on-close failed");
    std::wstring command;
    for (int i = split; i < argc; ++i) { if (!command.empty()) command += L" "; command += quote(argv[i]); }
    PROCESS_INFORMATION pi{};
    check(CreateProcessW(argv[split], command.data(), nullptr, nullptr, TRUE, EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW,
      nullptr, nullptr, &si.StartupInfo, &pi), "Create LPAC process failed");
    if (!AssignProcessToJobObject(job, pi.hProcess)) { TerminateProcess(pi.hProcess, 1); CloseHandle(pi.hThread); CloseHandle(pi.hProcess); throw std::runtime_error("Assign process to Job Object failed"); }
    ResumeThread(pi.hThread); CloseHandle(pi.hThread);
    DeleteProcThreadAttributeList(attributes); HeapFree(GetProcessHeap(), 0, attributes);
    WaitForSingleObject(pi.hProcess, INFINITE); DWORD code = 1; GetExitCodeProcess(pi.hProcess, &code); CloseHandle(pi.hProcess);
    exitCode = static_cast<int>(code);
  } catch (const std::exception& e) { std::cerr << "Native sandbox: " << e.what() << std::endl; }
  if (job) CloseHandle(job);
  if (sid) {
    for (auto i = granted.rbegin(); i != granted.rend(); ++i) try { acl(*i, sid, false, true); } catch (const std::exception& e) { std::cerr << "ACL cleanup: " << e.what() << std::endl; exitCode = 1; }
    if (exempted) loopback(sidString, false);
    DeleteAppContainerProfile(name.c_str()); FreeSid(sid);
  }
  return exitCode;
}
