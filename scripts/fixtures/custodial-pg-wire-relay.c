#include <sys/socket.h>
#include <sys/un.h>
#include <poll.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>
#include <time.h>
static int write_all(int fd,const void *buffer,size_t length){const char*p=buffer;while(length){ssize_t n=write(fd,p,length);if(n<0){if(errno==EINTR)continue;return -1;}if(!n)return -1;p+=n;length-=(size_t)n;}return 0;}
int main(int argc,char**argv){
 (void)argv;if(argc!=1)return 64;
 int db=socket(AF_UNIX,SOCK_STREAM,0);if(db<0){perror("fixture unix socket");return 65;}
 struct sockaddr_un address;memset(&address,0,sizeof(address));address.sun_family=AF_UNIX;
 strcpy(address.sun_path,"/var/run/postgresql/.s.PGSQL.5432");
 if(connect(db,(struct sockaddr*)&address,sizeof(address))<0){perror("fixture unix connect");close(db);return 66;}
 struct pollfd fds[2]={{.fd=STDIN_FILENO,.events=POLLIN},{.fd=db,.events=POLLIN}};char bytes[65536];time_t born=time(NULL);
 while(time(NULL)-born<600){
  int ready=poll(fds,2,1000);if(ready<0){if(errno==EINTR)continue;close(db);return 67;}
  if(fds[0].fd>=0&&(fds[0].revents&(POLLIN|POLLHUP))){ssize_t n=read(STDIN_FILENO,bytes,sizeof(bytes));
   if(n<0&&errno!=EINTR){close(db);return 68;}if(n==0){shutdown(db,SHUT_WR);fds[0].fd=-1;}else if(n>0&&write_all(db,bytes,(size_t)n)<0){close(db);return 69;}}
  if(fds[1].revents&(POLLIN|POLLHUP)){ssize_t n=read(db,bytes,sizeof(bytes));
   if(n<0&&errno!=EINTR){close(db);return 70;}if(n==0){close(db);return 0;}if(n>0&&write_all(STDOUT_FILENO,bytes,(size_t)n)<0){close(db);return 71;}}
  if((fds[0].revents|fds[1].revents)&(POLLERR|POLLNVAL)){close(db);return 72;}
 }
 close(db);return 73;
}
