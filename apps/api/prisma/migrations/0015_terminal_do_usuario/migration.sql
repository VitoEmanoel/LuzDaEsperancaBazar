-- Sprint 6, S6-21 (decisões do humano em 21/10/2026): terminal fixo no usuário, opcional.
-- O Administrador define no cadastro ("Ana → Caixa 1"); vários usuários podem ter o mesmo terminal (turnos).
-- Quem tem terminal definido só abre caixa nele: a API recusa (403) e o banco confere de novo.

ALTER TABLE "usuario" ADD COLUMN "terminal_id" UUID;
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "usuario_terminal_id_idx" ON "usuario"("terminal_id");

-- Abrir caixa: com terminal definido, só no dele. Vale só para caixas novos (os abertos antes continuam como estão).
CREATE OR REPLACE FUNCTION fn_caixa_no_terminal_do_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_terminal uuid;
BEGIN
  SELECT terminal_id INTO v_terminal FROM usuario WHERE id = NEW.aberto_por_id;
  IF v_terminal IS NOT NULL AND v_terminal <> NEW.terminal_id THEN
    PERFORM fn_falha('TERMINAL_DO_USUARIO', 'Este usuário só abre caixa no terminal definido para ele');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_caixa_no_terminal_do_usuario BEFORE INSERT ON "caixa_sessao" FOR EACH ROW EXECUTE FUNCTION fn_caixa_no_terminal_do_usuario();
