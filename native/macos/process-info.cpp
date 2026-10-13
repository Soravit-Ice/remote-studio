#include <libproc.h>
#include <sys/proc_info.h>
#include <unistd.h>
#include <poll.h>
#include <signal.h>
#include <vector>
#include <iostream>
#include <cstring>
#include <string>
#include <cerrno>
extern "C" int sandbox_check(pid_t,const char*,int,...) __attribute__((weak_import));
extern "C" const int SANDBOX_CHECK_NO_REPORT __attribute__((weak_import));
static std::string marker;
static bool scoped(pid_t pid){if(marker.empty())return true;const int a=sandbox_check(pid,nullptr,0),b=sandbox_check(pid,"file-read-data",1|SANDBOX_CHECK_NO_REPORT,marker.c_str()),c=sandbox_check(pid,"file-read-data",1|SANDBOX_CHECK_NO_REPORT,(marker+"-foreign").c_str());return a==1&&b==0&&c!=0;}
struct Process { pid_t pid; proc_bsdinfo info; };
static std::vector<Process> processes(){
 int size=proc_listallpids(nullptr,0);if(size<=0)throw "Cannot enumerate process scope";
 std::vector<pid_t> pids(size+256);int count=proc_listallpids(pids.data(),static_cast<int>(pids.size()*sizeof(pid_t)));if(count<0)throw "Cannot enumerate process scope";
 std::vector<Process> result;
 for(int i=0;i<count&&i<static_cast<int>(pids.size());i++){pid_t pid=pids[i];if(pid<=1||!scoped(pid))continue;proc_bsdinfo info{};if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))==sizeof(info))result.push_back({pid,info});}
 return result;
}
static void json(const std::vector<Process>& rows){
 std::cout<<"[";bool first=true;
 for(const auto& p:rows){if(!first)std::cout<<",";first=false;std::cout<<"{\"pid\":"<<p.pid<<",\"parent\":"<<p.info.pbi_ppid<<",\"group\":"<<getpgid(p.pid)<<",\"identity\":\""<<p.info.pbi_start_tvsec<<"."<<p.info.pbi_start_tvusec<<"\"}";}
 std::cout<<"]";
}
static void emit(pid_t root){std::cout<<"{\"type\":\"scope\",\"root\":"<<root<<",\"processes\":";json(processes());std::cout<<"}\n"<<std::flush;}
static void stop(bool freeze=false){
 // Match a unique native-policy capability, including reparented descendants.
 // Unsandboxed processes and policies with broad read access are excluded.
 for(const auto& p:processes())if(p.pid!=getpid())if(kill(p.pid,freeze?SIGSTOP:SIGTERM)<0&&errno!=ESRCH)throw "Native owned process could not be terminated";
 usleep(200000);
 for(const auto& p:processes())if(p.pid!=getpid())if(kill(p.pid,SIGKILL)<0&&errno!=ESRCH)throw "Native owned process could not be killed";
 std::cout<<"{\"type\":\"stopped\"}\n"<<std::flush;
}
int main(int argc,char** argv){try{
 if(argc==3&&std::strcmp(argv[1],"--reap-scope")==0){if(!sandbox_check||&SANDBOX_CHECK_NO_REPORT==nullptr)throw "Native scope query is unavailable";marker=argv[2];if(marker.rfind("/private/tmp/rs-scope-",0)!=0||marker.size()>100)throw "Invalid native scope marker";stop(true);return 0;}
 if(argc==4&&std::strcmp(argv[1],"--scope-census")==0){
  if(!sandbox_check||&SANDBOX_CHECK_NO_REPORT==nullptr)throw "Native sandbox scope query is unavailable";
  marker=argv[3];if(marker.rfind("/private/tmp/rs-scope-",0)!=0||marker.size()>100||!scoped(getpid()))throw "Native scope capability is unavailable";
  pid_t root=static_cast<pid_t>(std::strtol(argv[2],nullptr,10));if(root<=1)return 1;
  bool found=false;for(const auto& p:processes()){if(p.pid==root)found=true;else if(p.pid!=getpid()){std::cerr<<"Native process scope is not isolated. Refusing execution.\n";return 1;}}
  if(!found){std::cerr<<"Native root cannot be certified.\n";return 1;}
  emit(root);
  for(;;){pollfd control{0,POLLIN|POLLHUP,0};int result=poll(&control,1,250);if(result<0)return 1;if(result>0){char b;ssize_t count=read(0,&b,1);if(count<=0||b==2){stop();return 0;}}emit(root);}
 }
 json(processes());std::cout<<"\n";return 0;
 }catch(const char* error){std::cerr<<error<<"\n";return 1;}}
