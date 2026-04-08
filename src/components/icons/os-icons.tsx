import type React from "react";
import { Monitor, Server } from "lucide-react";
import {
  siUbuntu,
  siDebian,
  siFedora,
  siArchlinux,
  siAlpinelinux,
  siRedhat,
  siOpensuse,
  siApple,
  siFreebsd,
  siRaspberrypi,
  siNixos,
  siCentos,
  siAlmalinux,
  siRockylinux,
  siManjaro,
  siLinux,
  siKalilinux,
  siGentoo,
  siSlackware,
} from "simple-icons";
import type { SimpleIcon } from "simple-icons";

export interface IconProps {
  size?: number;
  className?: string;
}

const DEFAULT_SIZE = 20;

function SimpleIconComponent(icon: SimpleIcon, label: string) {
  return function OSIcon({
    size = DEFAULT_SIZE,
    className,
  }: IconProps): React.JSX.Element {
    return (
      <svg
        role="img"
        aria-label={label}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={`#${icon.hex}`}
        className={className}
      >
        <path d={icon.path} />
      </svg>
    );
  };
}

const Ubuntu = SimpleIconComponent(siUbuntu, "Ubuntu");
const Debian = SimpleIconComponent(siDebian, "Debian");
const Fedora = SimpleIconComponent(siFedora, "Fedora");
const Arch = SimpleIconComponent(siArchlinux, "Arch Linux");
const Alpine = SimpleIconComponent(siAlpinelinux, "Alpine Linux");
const RedHat = SimpleIconComponent(siRedhat, "Red Hat");
const SUSE = SimpleIconComponent(siOpensuse, "openSUSE");
const MacOS = SimpleIconComponent(siApple, "macOS");
const FreeBSD = SimpleIconComponent(siFreebsd, "FreeBSD");
const RaspberryPi = SimpleIconComponent(siRaspberrypi, "Raspberry Pi");
const NixOS = SimpleIconComponent(siNixos, "NixOS");
const CentOS = SimpleIconComponent(siCentos, "CentOS");
const AlmaLinux = SimpleIconComponent(siAlmalinux, "AlmaLinux");
const Rocky = SimpleIconComponent(siRockylinux, "Rocky Linux");
const Manjaro = SimpleIconComponent(siManjaro, "Manjaro");
const Linux = SimpleIconComponent(siLinux, "Linux");
const Kali = SimpleIconComponent(siKalilinux, "Kali Linux");
const Gentoo = SimpleIconComponent(siGentoo, "Gentoo");
const Slackware = SimpleIconComponent(siSlackware, "Slackware");

function Windows({
  size = DEFAULT_SIZE,
  className,
}: IconProps): React.JSX.Element {
  return (
    <Monitor width={size} height={size} className={className} color="#00ADEF" />
  );
}

function AmazonLinux({
  size = DEFAULT_SIZE,
  className,
}: IconProps): React.JSX.Element {
  return (
    <Server width={size} height={size} className={className} color="#FF9900" />
  );
}

function UnknownOS({
  size = DEFAULT_SIZE,
  className,
}: IconProps): React.JSX.Element {
  return <Server width={size} height={size} className={className} />;
}

export interface OSIconInfo {
  slug: string;
  label: string;
  component: (props: IconProps) => React.JSX.Element;
  osReleaseIds: string[];
}

export const OS_ICONS: OSIconInfo[] = [
  {
    slug: "ubuntu",
    label: "Ubuntu",
    component: Ubuntu,
    osReleaseIds: ["ubuntu"],
  },
  {
    slug: "debian",
    label: "Debian",
    component: Debian,
    osReleaseIds: ["debian"],
  },
  {
    slug: "centos",
    label: "CentOS",
    component: CentOS,
    osReleaseIds: ["centos"],
  },
  {
    slug: "almalinux",
    label: "AlmaLinux",
    component: AlmaLinux,
    osReleaseIds: ["almalinux"],
  },
  {
    slug: "rocky",
    label: "Rocky Linux",
    component: Rocky,
    osReleaseIds: ["rocky"],
  },
  {
    slug: "fedora",
    label: "Fedora",
    component: Fedora,
    osReleaseIds: ["fedora"],
  },
  {
    slug: "arch",
    label: "Arch Linux",
    component: Arch,
    osReleaseIds: ["arch"],
  },
  {
    slug: "manjaro",
    label: "Manjaro",
    component: Manjaro,
    osReleaseIds: ["manjaro"],
  },
  {
    slug: "alpine",
    label: "Alpine Linux",
    component: Alpine,
    osReleaseIds: ["alpine"],
  },
  { slug: "rhel", label: "Red Hat", component: RedHat, osReleaseIds: ["rhel"] },
  {
    slug: "suse",
    label: "openSUSE / SUSE",
    component: SUSE,
    osReleaseIds: ["opensuse", "opensuse-leap", "opensuse-tumbleweed", "sles"],
  },
  {
    slug: "macos",
    label: "macOS",
    component: MacOS,
    osReleaseIds: ["macos", "darwin"],
  },
  {
    slug: "windows",
    label: "Windows",
    component: Windows,
    osReleaseIds: ["windows"],
  },
  {
    slug: "freebsd",
    label: "FreeBSD",
    component: FreeBSD,
    osReleaseIds: ["freebsd"],
  },
  {
    slug: "raspbian",
    label: "Raspberry Pi OS",
    component: RaspberryPi,
    osReleaseIds: ["raspbian", "raspberrypi"],
  },
  {
    slug: "amzn",
    label: "Amazon Linux",
    component: AmazonLinux,
    osReleaseIds: ["amzn"],
  },
  { slug: "nixos", label: "NixOS", component: NixOS, osReleaseIds: ["nixos"] },
  {
    slug: "kali",
    label: "Kali Linux",
    component: Kali,
    osReleaseIds: ["kali"],
  },
  {
    slug: "gentoo",
    label: "Gentoo",
    component: Gentoo,
    osReleaseIds: ["gentoo"],
  },
  {
    slug: "slackware",
    label: "Slackware",
    component: Slackware,
    osReleaseIds: ["slackware"],
  },
  { slug: "linux", label: "Linux", component: Linux, osReleaseIds: ["linux"] },
];

export function getOSIcon(
  slug: string | null | undefined,
): (props: IconProps) => React.JSX.Element {
  if (!slug) return UnknownOS;
  const entry = OS_ICONS.find((i) => i.slug === slug);
  return entry?.component ?? UnknownOS;
}

export function osReleaseIdToSlug(osId: string): string | null {
  const lower = osId.toLowerCase().trim();
  for (const icon of OS_ICONS) {
    if (icon.osReleaseIds.includes(lower)) {
      return icon.slug;
    }
  }
  return null;
}

export { UnknownOS };
