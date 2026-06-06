// start_bot.exe(PE) 의 Optional Header Subsystem 필드를 GUI(2)로 바꿔 콘솔 창을 없앤다.
// CUI(3) → GUI(2). PE32/PE32+ 모두 Subsystem 은 Optional Header 시작 +68 오프셋.
export function patchSubsystemToGui(buf) {
  const peOff = buf.readUInt32LE(0x3c); // DOS 헤더 e_lfanew
  if (buf.toString('latin1', peOff, peOff + 4) !== 'PE\0\0') {
    throw new Error('PE 시그니처를 찾지 못했습니다');
  }
  const optOff = peOff + 24; // COFF file header(20) + "PE\0\0"(4)
  const subOff = optOff + 68; // IMAGE_OPTIONAL_HEADER.Subsystem
  const previous = buf.readUInt16LE(subOff);
  buf.writeUInt16LE(2, subOff); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  return { previous, offset: subOff };
}
