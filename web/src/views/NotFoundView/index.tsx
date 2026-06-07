import { Button, Intent, NonIdealState } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export const NotFoundView = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className="h-full flex items-center justify-center">
      <NonIdealState
        icon="search"
        title={t("common.notFound")}
        description={t("common.notFoundDesc")}
        action={
          <Button intent={Intent.PRIMARY} onClick={() => navigate("/dash")}>
            {t("common.backToHome")}
          </Button>
        }
      />
    </div>
  );
};
