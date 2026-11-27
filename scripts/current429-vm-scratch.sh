#!/usr/bin/env bash
# Sourced by the exact signed-backup workflow on the existing dedicated VM.

require_current429_unmounted() {
  local status
  if mountpoint -q -- "$1"; then
    printf 'Scratch target already mounted: %s\n' "$1" >&2
    return 1
  else
    status=$?
  fi
  # util-linux returns 32 for an existing path that is not a mountpoint.
  # Permission, path and system errors cannot establish that it is safe to bind.
  if [[ "$status" != 32 ]]; then
    printf 'Could not verify scratch mount state: %s (status %s)\n' "$1" "$status" >&2
    return 1
  fi
}

open_current429_vm_scratch() {
  test "${RUNNER_ENVIRONMENT:-}" = self-hosted
  test "${RUNNER_NAME:-}" = custodial-foundation-zorin
  test "${GITHUB_RUN_ATTEMPT:-}" = 1
  [[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]]
  test "$(findmnt -n -o TARGET -T /mnt/actions-runner)" = /mnt
  test "$(findmnt -n -o SOURCE -T /mnt/actions-runner)" = /dev/vdb1
  test "$(stat -c %d /mnt/actions-runner)" != "$(stat -c %d /)"
  test "$(df -B1 --output=avail /mnt/actions-runner | tail -n 1)" -ge 68719476736
  test -z "$(swapon --noheadings --show=TYPE)"
  test "$(docker info --format '{{.DockerRootDir}}')" = /mnt/docker
  containerd config dump | grep -Fx "root = '/var/lib/containerd'" >/dev/null
  test -z "$(docker ps -q)"
  require_current429_unmounted /mnt/docker || return 1
  require_current429_unmounted /var/lib/containerd || return 1
  systemctl is-active --quiet docker.service
  systemctl is-active --quiet docker.socket
  systemctl is-active --quiet containerd.service
  ulimit -c 0

  vm_scratch="$(mktemp -d /mnt/actions-runner/.signed-current429."$GITHUB_RUN_ID".XXXXXXXX)"
  vm_mapper="custodial-rehearsal-$GITHUB_RUN_ID"
  vm_mount="$vm_scratch/encrypted"
  mkdir -m 700 "$vm_mount"
  test ! -e "/dev/mapper/$vm_mapper"
  truncate -s 48G "$vm_scratch/volume"
  vm_loop="$(sudo -n losetup --find --show --nooverlap "$vm_scratch/volume")"
  [[ "$vm_loop" =~ ^/dev/loop[0-9]+$ ]]
  sudo -n cryptsetup open --type plain --cipher aes-xts-plain64 --key-size 512 \
    --key-file /dev/urandom "$vm_loop" "$vm_mapper"
  vm_mapper_open=true
  sudo -n mkfs.ext4 -q -F -E nodiscard "/dev/mapper/$vm_mapper"
  sudo -n mount -o nodev,nosuid "/dev/mapper/$vm_mapper" "$vm_mount"
  vm_mount_open=true
  sudo -n install -d -m 0700 "$vm_mount/docker" "$vm_mount/containerd"
  sudo -n install -d -m 0700 -o "$(id -u)" -g "$(id -g)" "$vm_mount/work" "$vm_mount/process-tmp"

  vm_docker_displaced=true
  sudo -n systemctl stop docker.socket docker.service containerd.service
  sudo -n mount --bind "$vm_mount/docker" /mnt/docker
  vm_docker_bound=true
  sudo -n mount --bind "$vm_mount/containerd" /var/lib/containerd
  vm_containerd_bound=true
  sudo -n systemctl start containerd.service docker.socket docker.service
  test "$(docker info --format '{{.DockerRootDir}}')" = /mnt/docker
  test -z "$(docker ps -aq)"
  test "$(stat -c %d "$vm_mount/work")" = "$(stat -c %d /mnt/docker)"
  test "$(stat -c %d "$vm_mount/work")" = "$(stat -c %d /var/lib/containerd)"
  test "$(stat -c %d "$vm_mount/work")" != "$(stat -c %d /mnt/actions-runner)"
  export RUNNER_TEMP="$vm_mount/work" TMPDIR="$vm_mount/process-tmp"
}

close_current429_vm_scratch() {
  if test "${vm_docker_displaced:-false}" = true; then
    sudo -n systemctl stop docker.socket docker.service containerd.service || return 1
  fi
  if test "${vm_docker_bound:-false}" = true; then
    sudo -n umount /mnt/docker || return 1
  fi
  if test "${vm_containerd_bound:-false}" = true; then
    sudo -n umount /var/lib/containerd || return 1
  fi
  if test "${vm_mount_open:-false}" = true; then
    sudo -n umount "$vm_mount" || return 1
  fi
  if test "${vm_mapper_open:-false}" = true; then
    sudo -n cryptsetup close "$vm_mapper" || return 1
    test ! -e "/dev/mapper/$vm_mapper" || return 1
  fi
  if test -n "${vm_loop:-}"; then
    sudo -n losetup -d "$vm_loop" || return 1
  fi
  if test -n "${vm_scratch:-}"; then
    rm -f -- "$vm_scratch/volume" || return 1
    rmdir -- "$vm_mount" "$vm_scratch" || return 1
  fi
  if test "${vm_docker_displaced:-false}" = true; then
    sudo -n systemctl start containerd.service docker.socket docker.service || return 1
    require_current429_unmounted /mnt/docker || return 1
    require_current429_unmounted /var/lib/containerd || return 1
    test "$(docker info --format '{{.DockerRootDir}}')" = /mnt/docker || return 1
  fi
}
