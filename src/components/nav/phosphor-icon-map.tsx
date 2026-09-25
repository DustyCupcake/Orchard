import type { Icon as PhosphorIconType, IconWeight } from "@phosphor-icons/react";
import {
  ArrowsClockwiseIcon,
  BookOpenIcon,
  CalendarBlankIcon,
  CalendarHeartIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ChatCircleDotsIcon,
  ChatCircleIcon,
  ChatsCircleIcon,
  CheckSquareIcon,
  ClipboardTextIcon,
  CompassIcon,
  EnvelopeSimpleIcon,
  GearSixIcon,
  HandHeartIcon,
  HandshakeIcon,
  HouseIcon,
  ListIcon,
  MailboxIcon,
  MapTrifoldIcon,
  PiggyBankIcon,
  PushPinIcon,
  QuestionIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SquaresFourIcon,
  StackIcon,
  UserCirclePlusIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";

// Maps the plain string keys used across nav-config.ts (kept as-is, so
// every NavItem/NavGroup definition stays untouched) onto the Phosphor
// icon components the design conventions call for. Weight is a prop,
// not a separate import — pass weight="fill" for the active/selected
// state (see design_handoff_conventions/README.md's Icons section),
// weight="regular" (the default) for everything else.
const PHOSPHOR_ICONS: Record<string, PhosphorIconType> = {
  home: HouseIcon,
  check: CheckSquareIcon,
  calendar: CalendarBlankIcon,
  calendarHeart: CalendarHeartIcon,
  clipboardText: ClipboardTextIcon,
  people: UsersThreeIcon,
  grid: SquaresFourIcon,
  budget: PiggyBankIcon,
  map: MapTrifoldIcon,
  recruitment: UserCirclePlusIcon,
  shield: ShieldCheckIcon,
  handshake: HandshakeIcon,
  gear: GearSixIcon,
  mail: EnvelopeSimpleIcon,
  cycle: ArrowsClockwiseIcon,
  // Communication/Library hub icons — the attention surfaces'
  // distinct glyphs, so a pinned Communication item never visually
  // collides with a People-family (Community) item in the pinned row.
  mailbox: MailboxIcon,
  question: QuestionIcon,
  chatCircleDots: ChatCircleDotsIcon,
  chatsCircle: ChatsCircleIcon,
  chatCircle: ChatCircleIcon,
  bookOpen: BookOpenIcon,
  // Tasks streamline icons — each pinnable Tasks sub-item keeps its
  // own glyph now that the sub-list no longer shares the board's.
  stack: StackIcon,
  handheart: HandHeartIcon,
  compass: CompassIcon,
  chevronLeft: CaretLeftIcon,
  chevronRight: CaretRightIcon,
  chevronDown: CaretDownIcon,
  menu: ListIcon,
  close: XIcon,
  pin: PushPinIcon,
  logout: SignOutIcon,
};

export function NavIcon({
  name,
  weight = "regular",
  size = 18,
  className,
}: {
  name: string;
  weight?: IconWeight;
  size?: number;
  className?: string;
}) {
  const IconComponent = PHOSPHOR_ICONS[name] ?? SquaresFourIcon;
  return <IconComponent weight={weight} size={size} className={className} />;
}
