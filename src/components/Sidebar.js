import React, { Component } from 'react';
import Scrollspy from 'react-scrollspy';
import Scroll from './Scroll';
import { Fade } from 'react-reveal';

import Logo from '../assets/img/logo.inline.svg';
import config from '../../config';

import { IntlContextConsumer, changeLocale } from 'gatsby-plugin-intl';

const LangSwitcher = () => {
  return (
    <IntlContextConsumer>
      {({ languages, language: currentLanguage }) => (
        <span className="lang-switcher txt-primary">
          {languages.map(lang => (
            <React.Fragment key={lang}>
              <button
                onClick={() => changeLocale(lang)}
                className={
                  'btn btn-link ' + (lang === currentLanguage ? 'active' : '')
                }
              >
                {lang}
              </button>
              {lang !== languages[languages.length - 1] && ' | '}
            </React.Fragment>
          ))}
        </span>
      )}
    </IntlContextConsumer>
  );
};

export class Sidebar extends Component {
  constructor(props) {
    super(props);
    this.state = {
      tabs: [
        { content: 'About', href: 'about' },
        { content: 'Experience', href: 'experience' },
        { content: 'Education', href: 'education' },
        { content: 'Skills', href: 'skills' },
        // { content: 'Interests', href: 'interests' },
        // { content: 'Awards', href: 'awards' },
      ],
    };
  }

  render() {
    const { tabs } = this.state;
    return (
      <nav
        className="navbar navbar-expand-lg navbar-dark bg-primary fixed-top"
        id="sideNav"
      >
        <a className="navbar-brand" href="#page-top">
          <Fade delay={0}>
            <span className="d-block d-lg-none">
              <Logo
                className="img-fluid mr-2"
                style={{ height: '32px', marginTop: '-6px' }}
              />
              {config.firstName} {config.lastName}
            </span>
          </Fade>
          <Fade delay={0}>
            <span className="d-none d-lg-block">
              <Logo
                className="img-fluid mx-auto mb-2"
                style={{ minWidth: '160px' }}
              />
            </span>
          </Fade>
        </a>

        <div className="collapse navbar-collapse" id="navbarSupportedContent">
          <Scrollspy
            items={tabs.map(s => s.href)}
            currentClassName="active"
            offset={-300}
            className="navbar-nav"
          >
            {tabs.map((tab, i) => {
              const { href, content } = tab;
              return (
                <li className="nav-item" key={href}>
                  <Scroll type="id" element={href}>
                    <Fade delay={100 + i * 100}>
                      <a className="nav-link" href={`#${href}`}>
                        {content}
                      </a>
                    </Fade>
                  </Scroll>
                </li>
              );
            })}
          </Scrollspy>
        </div>

        <LangSwitcher />
      </nav>
    );
  }
}

export default Sidebar;
